'use strict';

const fs = require('fs');
const { Markup } = require('telegraf');
const { deferBackground } = require('../../utils/defer');
const { getWaDivulgacaoClient, USER_PING_TIMEOUT_MS, USER_PAIRING_TIMEOUT_MS } = require('./waDivulgacaoClient');
const { ensureUserWorkerReady } = require('./waDivulgacaoWorkerService');
const { resolveUserSession } = require('./waDivulgacaoUserSession');
const { pushWaDivulgacaoPanel, resolveWaDivChatId } = require('./helpers/waDivulgacaoPanelUi');
const {
    pairingFlowKeyboard,
    qrFlowKeyboard,
    connectedSuccessKeyboard,
    phonePromptKeyboard,
    connectChoiceKeyboard,
    formatPairCodeForCopy,
} = require('./keyboards/waDivulgacaoKeyboards');
const logger = require('../../config/logger');
const Copy = require('./waDivulgacaoCopy');

const QR_REFRESH_MIN_MS = 8000;

const PAIRING_TRANSIENT_RE =
    /connection closed|connection terminated|terminated by server|timed out|websocket|preconnect|econnreset|etimedout|socket hang up/i;

async function tgSendWithRetry(fn, attempts = 3) {
    let lastErr;
    for (let i = 0; i < attempts; i++) {
        try {
            return await fn();
        } catch (e) {
            lastErr = e;
            if (i < attempts - 1) {
                await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
            }
        }
    }
    throw lastErr;
}

class WaDivulgacaoLoginService {
    constructor() {
        this._flow = new Map();
        this._eventOffsets = new Map();
        this._eventTimer = null;
    }

    _flowKey(telegramId) {
        return String(telegramId);
    }

    _qrInstructions() {
        return (
            '📱 <b>Conectar por QR Code</b>\n\n' +
            'No celular: <b>WhatsApp → Aparelhos conectados → Conectar aparelho</b>\n\n' +
            '<i>O QR renova automaticamente nesta mensagem.</i>'
        );
    }

    _phonesMatch(a, b) {
        const da = this._normalizePhone(a) || String(a || '').replace(/\D/g, '');
        const db = this._normalizePhone(b) || String(b || '').replace(/\D/g, '');
        if (!da || !db) return false;
        if (da === db) return true;
        const strip55 = (x) => (x.startsWith('55') ? x.slice(2) : x);
        return strip55(da) === strip55(db);
    }

    async _prepareSessionForLogin(client, uid, targetPhone = null) {
        const state = (await this.fetchConnectionState(uid, client)) || client.readState();
        if (!state?.connected || !state.phone) return { ok: true };

        if (targetPhone && this._phonesMatch(state.phone, targetPhone)) {
            return { ok: true, alreadyConnected: true, phone: state.phone };
        }

        if (!targetPhone) {
            return { ok: true, alreadyConnected: true, phone: state.phone };
        }

        const current = state.phone;
        await client.sendCommand('wa.clear_antiban_pause', {}, uid).catch(() => {});
        const ack = await client.sendCommand('wa.logout', {}, uid);
        if (!ack?.ok) {
            return {
                ok: false,
                message:
                    `❌ WhatsApp conectado em <code>${current}</code>.\n` +
                    'Não foi possível encerrar a sessão.\n' +
                    'Use <b>Desconectar</b> no painel e tente de novo.',
            };
        }

        await new Promise((r) => setTimeout(r, 2500));
        return { ok: true, swapped: true, previousPhone: current };
    }

    /** Igual ao admin — texto puro via sendMessage (nunca legenda de foto). */
    _formatPairToken(raw) {
        const digits = String(raw || '').replace(/\D/g, '').slice(0, 8);
        if (digits.length === 8) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
        return String(raw || '').trim() || '????-????';
    }

    _pairInstructions(formatted, phone) {
        const visual = this._formatPairToken(formatted);
        const digits = visual.replace(/\D/g, '');
        const display = phone ? this.formatPhoneDisplay(phone) : String(phone || '');
        return (
            '🔢 <b>Conectar por código — Hanork Div</b>\n\n' +
            `Código: <b>${visual}</b>\n` +
            (display ? `Número: <code>${display}</code>\n\n` : '\n') +
            '<b>No celular</b> (app WhatsApp):\n' +
            '1. Menu ⋮ → <b>Aparelhos conectados</b>\n' +
            '2. <b>Conectar aparelho</b> → <b>Conectar com número de telefone</b>\n' +
            '3. Toque em <b>📋 Copiar código</b> abaixo e cole no WhatsApp\n\n' +
            '<i>Válido por ~1 minuto. Demorou? Use <b>Novo código</b>.</i>'
        );
    }

    _pairingKeyboardFor(result, pairCode = null) {
        if (!result?.ok) return phonePromptKeyboard();
        if (result.alreadyConnected) return connectedSuccessKeyboard();
        const code = pairCode || result.pairCode || null;
        if (result.hasFullCode || code || /Conectar por código/i.test(result.message || '')) {
            return pairingFlowKeyboard(code);
        }
        return phonePromptKeyboard();
    }

    _normalizePhone(raw) {
        let digits = String(raw || '').replace(/\D/g, '');
        if (!digits) return null;
        if (digits.startsWith('00')) digits = digits.slice(2);
        if (digits.length < 10 || digits.length > 15) return null;
        return digits;
    }

    formatPhoneDisplay(digits) {
        const d = String(digits || '').replace(/\D/g, '');
        if (!d) return '';
        if (d.startsWith('55') && d.length >= 12) {
            const rest = d.slice(2);
            const ddd = rest.slice(0, 2);
            const num = rest.slice(2);
            if (num.length === 9) return `+55 ${ddd} ${num.slice(0, 5)}-${num.slice(5)}`;
            if (num.length === 8) return `+55 ${ddd} ${num.slice(0, 4)}-${num.slice(4)}`;
        }
        if (d.startsWith('54') && d.length >= 12) {
            const rest = d.slice(2);
            if (rest.startsWith('9') && rest.length === 11) {
                const area = rest.slice(1, 4);
                const num = rest.slice(4);
                return `+54 9 ${area} ${num.slice(0, 3)}-${num.slice(3)}`;
            }
        }
        return `+${d}`;
    }

    connectChoiceMessage() {
        return (
            '📲 <b>Conectar seu WhatsApp</b>\n\n' +
            'Escolha como autenticar:\n\n' +
            '📱 <b>QR Code</b> — escaneie no celular\n' +
            '🔢 <b>Código</b> — informe seu número e use o código de 8 dígitos\n\n' +
            '<i>A sessão fica salva — reconecta sozinha após reinícios.</i>'
        );
    }

    phonePromptMessage() {
        return Copy.phonePromptMessage();
    }

    _flowNotifyCtx(ctx, telegramId) {
        const chatId = resolveWaDivChatId(ctx, telegramId);
        if (!ctx?.telegram || !chatId) return null;
        return { telegram: ctx.telegram, chatId, userId: telegramId };
    }

    isAwaitingPhone(telegramId) {
        const s = this._flow.get(this._flowKey(telegramId));
        return s?.step === 'await_phone';
    }

    async cancel(telegramId) {
        this._flow.delete(this._flowKey(telegramId));
    }

    async _guardWorker(telegramId) {
        const guard = await ensureUserWorkerReady(telegramId);
        if (!guard.ok) {
            return {
                ok: false,
                message:
                    guard.message ||
                    '⚠️ Serviço WhatsApp indisponível no momento.\nTente novamente em instantes.',
            };
        }
        return { ok: true, client: guard.client };
    }

    _formatConnectionDetails(state) {
        if (!state) return '';
        let extra = '';
        if (state.waDisplayName) extra += `\n🖥 <b>Aparelho:</b> ${state.waDisplayName}`;
        if (state.updatedAt) {
            const when = new Date(state.updatedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
            extra += `\n🔄 <b>Última sync:</b> ${when}`;
        }
        if (state.activeGroups != null) extra += `\n👥 <b>Grupos ativos:</b> ${state.activeGroups}`;
        return extra;
    }

    async showConnectChoice(telegramId, ctx) {
        const { scheduleWorkerPrewarm } = require('./waDivulgacaoWorkerService');
        scheduleWorkerPrewarm(telegramId, 'connect');

        const fkey = this._flowKey(telegramId);
        const existing = this._flow.get(fkey);
        if (existing?.step === 'qr') {
            return {
                ok: true,
                alreadyAwaiting: true,
                message:
                    '📲 <b>Aguardando QR…</b>\n\n' +
                    'A imagem chega em instantes.\n' +
                    'Expirou? Toque em <b>Atualizar QR</b>.',
            };
        }
        if (existing?.step === 'pair' || existing?.step === 'await_phone') {
            return {
                ok: true,
                alreadyAwaiting: true,
                message:
                    '⏳ <b>Pareamento em andamento</b>\n\n' +
                    'Aguarde o código de 8 dígitos ou use <b>Novo código</b>.',
            };
        }

        const { client } = getWaDivulgacaoClient(telegramId);
        const state = (await this.fetchConnectionState(telegramId, client)) || client.readState();
        if (state?.connected) {
            return {
                ok: true,
                alreadyConnected: true,
                message:
                    `🟢 <b>WhatsApp conectado</b>` +
                    (state.phone ? `\n📞 <code>${state.phone}</code>` : '') +
                    (state.pushName ? `\n📱 ${state.pushName}` : '') +
                    this._formatConnectionDetails(state),
                state,
            };
        }

        return { ok: true, choose: true, message: this.connectChoiceMessage() };
    }

    async startQr(telegramId, ctx) {
        const { scheduleWorkerPrewarm } = require('./waDivulgacaoWorkerService');
        scheduleWorkerPrewarm(telegramId, 'qr');

        const fkey = this._flowKey(telegramId);
        const existing = this._flow.get(fkey);
        if (existing?.step === 'qr') {
            return {
                ok: true,
                alreadyAwaiting: true,
                message: '📲 <b>Já estou aguardando o QR</b>\n\nA imagem atualiza automaticamente.',
            };
        }
        if (existing?.step === 'pair' || existing?.step === 'await_phone') {
            return {
                ok: false,
                message:
                    '⏳ <b>Pareamento em andamento</b>\n\n' +
                    'Aguarde o código ou use <b>Novo código</b> antes de trocar para QR.',
            };
        }

        const { client } = getWaDivulgacaoClient(telegramId);
        const state = (await this.fetchConnectionState(telegramId, client)) || client.readState();
        if (state?.connected) {
            return {
                ok: true,
                alreadyConnected: true,
                message: `🟢 Já conectado — <code>${state.phone || '?'}</code>`,
                state,
            };
        }

        await this.cancel(telegramId);
        this._flow.set(fkey, {
            step: 'qr',
            telegramId,
            notify: this._flowNotifyCtx(ctx, telegramId),
            qrMessageId: null,
            lastQrToken: null,
            lastQrSentAt: 0,
        });

        deferBackground(`wadv-qr-boot-${telegramId}`, () => this._bootQrLogin(telegramId, ctx));

        return {
            ok: true,
            message: '📲 <b>Aguardando QR…</b>\n\nA imagem chega em instantes.',
        };
    }

    async _bootQrLogin(telegramId, ctx) {
        const fkey = this._flowKey(telegramId);
        const flow = this._flow.get(fkey);
        if (!flow || flow.step !== 'qr') return;

        const guard = await this._guardWorker(telegramId);
        if (!guard.ok) {
            await this._notify(flow, guard.message, connectChoiceKeyboard());
            return;
        }

        const { client } = guard;
        const uid = Number(telegramId);

        this._ensureEventWatcher(telegramId);
        this._syncEventOffset(client, telegramId);

        const live = await this.fetchConnectionState(uid, client);
        if (live?.connected) {
            this._flow.delete(fkey);
            await this._refreshHomePanel(flow, live.phone);
            return;
        }

        await client.sendCommand('wa.clear_antiban_pause', {}, uid).catch(() => {});
        const ack = await client.sendCommand('wa.start_login', {}, uid);
        if (!ack.ok) {
            this._flow.delete(fkey);
            await this._notify(
                flow,
                `❌ ${ack.message || ack.error || 'Falha ao iniciar QR'}`,
                connectChoiceKeyboard()
            );
            return;
        }

        deferBackground(`wadv-qr-${telegramId}`, () => this._pollEvents(telegramId));
    }

    async promptPhone(telegramId, ctx) {
        const { scheduleWorkerPrewarm } = require('./waDivulgacaoWorkerService');
        scheduleWorkerPrewarm(telegramId, 'pair');

        const fkey = this._flowKey(telegramId);
        const existing = this._flow.get(fkey);
        if (existing?.step === 'pair') {
            return {
                ok: true,
                alreadyAwaiting: true,
                message:
                    '⏳ <b>Pareamento em andamento</b>\n\n' +
                    'Aguarde o código ou use <b>Novo código</b> se expirou.',
            };
        }
        if (existing?.step === 'qr') {
            return {
                ok: false,
                message:
                    '📲 <b>Login por QR em andamento</b>\n\n' +
                    'Aguarde o QR ou volte e escolha outro método depois.',
            };
        }

        const { client } = getWaDivulgacaoClient(telegramId);
        const live = (await this.fetchConnectionState(telegramId, client)) || client.readState();
        if (live?.connected) {
            return { ok: true, alreadyConnected: true, message: '🟢 WhatsApp já está conectado.' };
        }

        await this.cancel(telegramId);
        this._flow.set(this._flowKey(telegramId), {
            step: 'await_phone',
            telegramId,
            notify: this._flowNotifyCtx(ctx, telegramId),
        });
        this._ensureEventWatcher(telegramId);
        const { client } = getWaDivulgacaoClient(telegramId);
        this._syncEventOffset(client, telegramId);

        return { ok: true, message: this.phonePromptMessage() };
    }

    /** Reenvia código com o mesmo número (botão «Novo código»). */
    async retryPairing(telegramId, ctx) {
        const fkey = this._flowKey(telegramId);
        const existing = this._flow.get(fkey);
        const phone = existing?.pairPhone || existing?.phone;
        if (!phone) {
            return this.promptPhone(telegramId, ctx);
        }
        const notify = existing?.notify || this._flowNotifyCtx(ctx, telegramId);
        if (!notify) {
            return { ok: false, message: '❌ Sessão expirada — toque em <b>Código</b> de novo.' };
        }
        this._flow.set(fkey, {
            step: 'pair',
            telegramId,
            pairPhone: phone,
            phone,
            pairRetries: 0,
            pairCodeSent: null,
            notify,
        });
        this._ensureEventWatcher(telegramId);
        const { client } = getWaDivulgacaoClient(telegramId);
        this._syncEventOffset(client, telegramId);
        await this._notify(
            { notify, telegramId },
            '⏳ <b>Gerando novo código…</b>\n\n<i>Válido por ~1 minuto no WhatsApp.</i>'
        );
        deferBackground(`wadv-pair-retry-${telegramId}`, () =>
            this._runPairingJob(telegramId, ctx, phone, { notify, telegramId })
        );
        return { ok: true, message: '⏳ Gerando novo código…' };
    }

    async _runPairingJob(telegramId, ctx, phone, notifyState) {
        const fkey = this._flowKey(telegramId);
        try {
            const result = await this.startPairing(telegramId, ctx, phone);
            const s = this._flow.get(fkey) || notifyState;
            if (!s?.notify) return;
            if (!result.ok) {
                await this._notify(s, result.message, phonePromptKeyboard());
                return;
            }
            if (result.alreadyConnected) {
                await this._refreshHomePanel(s, result.phone || phone);
                return;
            }
            await this._notify(s, result.message, this._pairingKeyboardFor(result, result.pairCode));
        } catch (e) {
            logger.error('[WaDivulgacao] pairing failed', {
                telegramId,
                phone,
                error: e?.message || String(e),
            });
            const s = this._flow.get(fkey) || notifyState;
            if (s?.notify) {
                await this._notify(
                    s,
                    '❌ Não foi possível gerar o código agora.\n\nTente de novo em instantes ou use <b>QR Code</b>.',
                    phonePromptKeyboard()
                );
            }
        }
    }

    async tryPhoneInput(telegramId, ctx, text) {
        const fkey = this._flowKey(telegramId);
        const s = this._flow.get(fkey);
        if (!s || s.step !== 'await_phone') return false;

        const trimmed = String(text || '').trim();
        if (!trimmed || trimmed.startsWith('/')) {
            await this._notify(s, Copy.phoneInvalidExample(), phonePromptKeyboard());
            return true;
        }

        const phone = this._normalizePhone(trimmed);
        if (!phone) {
            await this._notify(
                s,
                '❌ Número inválido. Use DDI + DDD + número (com ou sem +).',
                phonePromptKeyboard()
            );
            return true;
        }

        const notify = { ...s };
        this._flow.set(fkey, {
            step: 'pair',
            telegramId,
            phone,
            pairPhone: phone,
            pairRetries: 0,
            notify: s.notify,
        });
        this._ensureEventWatcher(telegramId);
        this._syncEventOffset(getWaDivulgacaoClient(telegramId).client, telegramId);
        await this._notify(
            notify,
            '⏳ <b>Gerando código de pareamento…</b>\n\n<i>Você tem 1 minuto para digitar no celular.</i>'
        );
        logger.info('[WaDivulgacao] phone input', { telegramId, phone });
        deferBackground(`wadv-pair-input-${telegramId}`, () =>
            this._runPairingJob(telegramId, ctx, phone, notify)
        );
        return true;
    }

    /** Aceita número enviado fora do fluxo (ex.: usuário não tocou em Código antes). */
    async tryPhoneInputDirect(telegramId, ctx, text) {
        if (this.isAwaitingPhone(telegramId)) return false;
        const { getWaDivulgacaoCampaignService } = require('./waDivulgacaoCampaignService');
        if (getWaDivulgacaoCampaignService().hasActiveSession(telegramId)) return false;
        const phone = this._normalizePhone(text);
        if (!phone) return false;
        const notify = this._flowNotifyCtx(ctx, telegramId);
        if (!notify) return false;

        const { client } = getWaDivulgacaoClient(telegramId);
        const live = (await this.fetchConnectionState(telegramId, client)) || client.readState();
        if (live?.connected) {
            await this._refreshHomePanel({ notify, telegramId }, live.phone);
            return true;
        }

        await this.cancel(telegramId);
        const pseudo = { notify, telegramId };
        const fkey = this._flowKey(telegramId);
        this._flow.set(fkey, {
            step: 'pair',
            telegramId,
            phone,
            pairPhone: phone,
            pairRetries: 0,
            notify,
        });
        this._ensureEventWatcher(telegramId);
        this._syncEventOffset(client, telegramId);
        await this._notify(
            pseudo,
            '⏳ <b>Gerando código de pareamento…</b>\n\n<i>Você tem 1 minuto para digitar no celular.</i>'
        );
        logger.info('[WaDivulgacao] phone input direct', { telegramId, phone });
        deferBackground(`wadv-pair-direct-${telegramId}`, () =>
            this._runPairingJob(telegramId, ctx, phone, pseudo)
        );
        return true;
    }

    async _sendPairingIpc(client, uid, phone) {
        await client.sendCommand('wa.clear_antiban_pause', {}, uid, { timeoutMs: 8000 }).catch(() => {});
        const ack = await client.sendCommand(
            'wa.start_pairing',
            { phone, forceSwap: true },
            uid,
            { timeoutMs: USER_PAIRING_TIMEOUT_MS }
        );
        if (ack?.ok) return ack;

        const offline =
            ack?.error === 'timeout' ||
            /offline|sem resposta/i.test(String(ack?.message || ack?.error || ''));
        if (offline && (client.isWorkerLikelyOnline() || (await this._pingWorker(client, uid)))) {
            logger.warn('[WaDivulgacao] start_pairing IPC lento — aguardando código via eventos', {
                telegramId: uid,
                phone,
            });
            return {
                ok: true,
                slowIpc: true,
                result: { ok: true, waiting: true, phone },
            };
        }
        return ack;
    }

    async _pingWorker(client, uid) {
        const ping = await client
            .sendCommand('wa.ping', {}, uid, { timeoutMs: USER_PING_TIMEOUT_MS })
            .catch(() => null);
        return Boolean(ping?.ok);
    }

    async startPairing(telegramId, ctx, phoneRaw) {
        const phone = this._normalizePhone(phoneRaw);
        if (!phone) return { ok: false, message: '❌ Número inválido.' };

        const fkey = this._flowKey(telegramId);
        const existing = this._flow.get(fkey);
        if (existing?.step === 'qr') {
            return {
                ok: false,
                message:
                    '📲 <b>Login por QR em andamento</b>\n\n' +
                    'Aguarde o QR ou volte antes de usar pareamento por código.',
            };
        }

        const guard = await this._guardWorker(telegramId);
        if (!guard.ok) return guard;

        const { client } = guard;
        const uid = Number(telegramId);

        const prep = await this._prepareSessionForLogin(client, uid, phone);
        if (!prep.ok) return prep;
        if (prep.alreadyConnected) {
            this._flow.delete(fkey);
            return {
                ok: true,
                alreadyConnected: true,
                phone: prep.phone,
                message: `🟢 <b>WhatsApp já conectado</b>\n📞 <code>${this.formatPhoneDisplay(prep.phone) || prep.phone}</code>`,
            };
        }
        if (prep.swapped && ctx?.telegram && ctx?.chat?.id) {
            await this._notify(
                { notify: { telegram: ctx.telegram, chatId: ctx.chat.id } },
                `🔄 Sessão anterior (<code>${prep.previousPhone}</code>) encerrada — gerando código…`
            );
        }

        logger.info('[WaDivulgacao] startPairing', { telegramId: uid, phone });

        const preservedNotify = this._flowNotifyCtx(ctx, telegramId) || this._flow.get(fkey)?.notify;
        await this.cancel(telegramId);
        this._flow.set(fkey, {
            step: 'pair',
            telegramId,
            pairPhone: phone,
            phone,
            pairRetries: 0,
            notify: preservedNotify,
            qrMessageId: null,
            lastQrToken: null,
            lastQrSentAt: 0,
        });
        this._ensureEventWatcher(telegramId);
        this._syncEventOffset(client, telegramId);

        await client.sendCommand('wa.clear_antiban_pause', {}, uid, { timeoutMs: 5000 }).catch(() => {});
        const ack = await this._sendPairingIpc(client, uid, phone);
        if (!ack.ok) {
            this._flow.delete(fkey);
            logger.warn('[WaDivulgacao] start_pairing IPC failed', {
                telegramId: uid,
                error: ack.message || ack.error,
            });
            return { ok: false, message: `❌ ${ack.message || ack.error || 'Falha no pareamento'}` };
        }

        const r = ack.result?.result || ack.result || {};
        if (r.alreadyConnected) {
            this._flow.delete(fkey);
            return {
                ok: true,
                alreadyConnected: true,
                message: `🟢 <b>WhatsApp já conectado</b>\n📞 <code>${r.phone || phone}</code>`,
            };
        }
        if (r.formatted || r.code) {
            const token = r.formatted || r.code;
            const flow = this._flow.get(fkey);
            if (flow) flow.pairCodeSent = token;
            deferBackground(`wadv-pair-${telegramId}`, () => this._pollEvents(telegramId));
            return {
                ok: true,
                hasFullCode: true,
                pairCode: token,
                message: this._pairInstructions(token, phone),
            };
        }

        deferBackground(`wadv-pair-wait-${telegramId}`, () => this._pollEvents(telegramId));
        return {
            ok: true,
            hasFullCode: false,
            message:
                '⏳ <b>Gerando código de pareamento…</b>\n\n' +
                `Número: <code>${this.formatPhoneDisplay(phone)}</code>\n\n` +
                'O código de 8 dígitos chega em instantes.',
        };
    }

    async disconnect(telegramId) {
        const guard = await this._guardWorker(telegramId);
        if (!guard.ok) return guard;
        const ack = await guard.client.sendCommand('wa.logout', {}, Number(telegramId));
        await this.cancel(telegramId);
        if (!ack?.ok) {
            return { ok: false, message: `❌ ${ack.message || 'Não foi possível desconectar'}` };
        }
        return { ok: true, message: '✅ WhatsApp desconectado.' };
    }

    readConnectionState(telegramId) {
        try {
            const { client } = getWaDivulgacaoClient(telegramId);
            return client.readState();
        } catch {
            return null;
        }
    }

    async fetchConnectionState(telegramId, client = null) {
        try {
            const c = client || getWaDivulgacaoClient(telegramId).client;
            const cached = c.readState();
            const uid = Number(telegramId);
            const ack = await c
                .sendCommand('wa.get_status', {}, uid, { timeoutMs: USER_PING_TIMEOUT_MS })
                .catch(() => null);
            if (ack?.ok && ack.result) {
                return { ...cached, ...ack.result };
            }
            return cached;
        } catch {
            return null;
        }
    }

    async _refreshHomePanel(s, phone = null) {
        if (!s?.notify?.telegram || !s.notify.chatId) return;
        try {
            const { buildActiveHomePanel } = require('./handlers/waDivulgacaoUiHandlers');
            const panel = await buildActiveHomePanel(s.notify.userId || s.telegramId);
            if (!panel) return;
            let text = panel.text;
            if (phone) {
                const display = this.formatPhoneDisplay(phone);
                text =
                    `✅ <b>WhatsApp conectado!</b>` +
                    (display ? `\n📞 <code>${display}</code>\n\n` : '\n\n') +
                    panel.text;
            }
            await pushWaDivulgacaoPanel(
                s.notify.telegram,
                s.notify.chatId,
                s.notify.userId || s.telegramId,
                text,
                panel.keyboard
            );
        } catch (e) {
            logger.warn('[WaDivulgacao] refresh home panel failed', { error: e?.message });
        }
    }

    _ensureEventWatcher(telegramId) {
        if (this._eventTimer) return;
        this._eventTimer = setInterval(() => {
            for (const [fkey] of this._flow.entries()) {
                this._pollEvents(fkey).catch((e) => {
                    logger.warn('[WaDivulgacao] poll events failed', { fkey, error: e?.message });
                });
            }
        }, 400);
        if (this._eventTimer.unref) this._eventTimer.unref();
    }

    _syncEventOffset(client, telegramId) {
        const conf = resolveUserSession(telegramId);
        try {
            const eventsFile = client.files.events;
            if (fs.existsSync(eventsFile)) {
                this._eventOffsets.set(conf.sessionId, fs.statSync(eventsFile).size);
            }
        } catch {
            /* ignore */
        }
    }

    async _pollEvents(telegramId) {
        const fkey = this._flowKey(telegramId);
        const s = this._flow.get(fkey);
        if (!s) return;

        const { client, conf } = getWaDivulgacaoClient(telegramId);
        const offset = this._eventOffsets.get(conf.sessionId) || 0;
        const { events, nextOffset } = await client.readEventsSince(offset);
        this._eventOffsets.set(conf.sessionId, nextOffset);

        for (const ev of events) {
            if (ev.type === 'wa.pairing_code') {
                if (s.step !== 'pair' || !(ev.formatted || ev.code)) continue;
                const token = ev.formatted || ev.code;
                if (s.pairCodeSent === token) continue;
                s.pairCodeSent = token;
                await this._notify(
                    s,
                    this._pairInstructions(token, ev.phone || s.pairPhone || s.phone),
                    pairingFlowKeyboard(token)
                );
                try {
                    await pushWaDivulgacaoPanel(
                        s.notify.telegram,
                        s.notify.chatId,
                        s.notify.userId || s.telegramId,
                        this._pairInstructions(token, ev.phone || s.pairPhone || s.phone),
                        pairingFlowKeyboard(token)
                    );
                } catch {
                    /* painel opcional — _notify já enviou */
                }
            }
            if (ev.type === 'wa.pairing_failed') {
                const transient = PAIRING_TRANSIENT_RE.test(ev.message || '');
                if (transient && !s.pairRetries && (s.pairPhone || s.phone)) {
                    s.pairRetries = 1;
                    await this._notify(
                        s,
                        `⏳ ${ev.message || 'Erro de rede'} — tentando gerar código de novo…`,
                        pairingFlowKeyboard(s.pairCodeSent, { useCallbackCopy: !s.pairCodeSent })
                    );
                    const retryPhone = s.pairPhone || s.phone;
                    deferBackground(`wadv-pair-retry-ev-${telegramId}`, () =>
                        this._sendPairingIpc(client, Number(telegramId), retryPhone).catch(() => {})
                    );
                    continue;
                }
                await this._notify(
                    s,
                    `❌ <b>Falha no pareamento</b>\n${ev.message || 'erro desconhecido'}\n\n` +
                        'Tente <b>Novo código</b> ou use <b>QR Code</b>.',
                    phonePromptKeyboard()
                );
                this._flow.delete(fkey);
            }
            if (ev.type === 'wa.qr' && ev.pngBase64 && s.step === 'qr') {
                await this._sendQrPhoto(s, ev.pngBase64, { tokenKey: ev.at });
            }
            if (ev.type === 'wa.connected') {
                await this._clearQrPhoto(s);
                await this._refreshHomePanel(s, ev.phone);
                this._flow.delete(fkey);
            }
        }
    }

    getLastPairCode(telegramId) {
        const s = this._flow.get(this._flowKey(telegramId));
        return s?.pairCodeSent || null;
    }

    /** Sempre sendMessage — nunca foto/legenda (pareamento igual admin). */
    async _notify(s, text, markup = null) {
        if (!s?.notify?.telegram || !s.notify.chatId || !text) return;
        const opts = { parse_mode: 'HTML', disable_web_page_preview: true };
        if (markup) {
            const kb =
                markup.reply_markup || markup.inline_keyboard
                    ? markup
                    : Markup.inlineKeyboard(markup.inline_keyboard || markup);
            Object.assign(opts, kb);
        }
        try {
            await tgSendWithRetry(() => s.notify.telegram.sendMessage(s.notify.chatId, text, opts));
        } catch (e) {
            const pairCode = this.getLastPairCode(s.telegramId || s.notify?.userId);
            const copyRejected = String(e?.message || '').match(/copy_text|BUTTON_COPY|button type/i);
            if (copyRejected && pairCode) {
                try {
                    const fallbackOpts = {
                        parse_mode: 'HTML',
                        disable_web_page_preview: true,
                        ...pairingFlowKeyboard(pairCode, { useCallbackCopy: true }),
                    };
                    await s.notify.telegram.sendMessage(s.notify.chatId, text, fallbackOpts);
                    return;
                } catch (e2) {
                    logger.warn('[WaDivulgacao] notify copy fallback failed', { error: e2?.message });
                }
            }
            logger.warn('[WaDivulgacao] notify failed', { error: e?.message });
        }
    }

    async _notifyPanel(s, text, markup) {
        if (!s?.notify?.telegram || !s.notify.chatId) return;
        try {
            await pushWaDivulgacaoPanel(s.notify.telegram, s.notify.chatId, s.notify.userId || s.telegramId, text, markup);
        } catch (e) {
            logger.warn('[WaDivulgacao] notify panel failed — fallback sendMessage', { error: e?.message });
            await this._notify(s, text, markup).catch(() => {});
        }
    }

    async _clearQrPhoto(s) {
        if (!s?.qrMessageId || !s.notify?.telegram) return;
        try {
            await s.notify.telegram.deleteMessage(s.notify.chatId, s.qrMessageId);
        } catch {
            /* ignore */
        }
        s.qrMessageId = null;
    }

    async _sendQrPhoto(s, pngBase64, { tokenKey = null, force = false } = {}) {
        if (!s?.notify?.telegram || !s.notify.chatId || !pngBase64) return;

        const now = Date.now();
        if (!force && tokenKey && tokenKey === s.lastQrToken) return;
        if (!force && s.lastQrSentAt && now - s.lastQrSentAt < QR_REFRESH_MIN_MS) return;

        s.lastQrToken = tokenKey || s.lastQrToken;
        s.lastQrSentAt = now;

        const caption = this._qrInstructions();
        const { telegram, chatId } = s.notify;
        const source = Buffer.from(pngBase64, 'base64');

        try {
            if (s.qrMessageId) {
                try {
                    await telegram.editMessageMedia(
                        chatId,
                        s.qrMessageId,
                        undefined,
                        { type: 'photo', media: { source }, caption, parse_mode: 'HTML' }
                    );
                    return;
                } catch {
                    await telegram.deleteMessage(chatId, s.qrMessageId).catch(() => {});
                    s.qrMessageId = null;
                }
            }
            const sent = await telegram.sendPhoto(chatId, { source }, { caption, parse_mode: 'HTML' });
            s.qrMessageId = sent?.message_id ?? null;
        } catch {
            await this._notify(s, caption);
        }
    }
}

let singleton = null;

function getWaDivulgacaoLoginService() {
    if (!singleton) singleton = new WaDivulgacaoLoginService();
    return singleton;
}

module.exports = { WaDivulgacaoLoginService, getWaDivulgacaoLoginService };
