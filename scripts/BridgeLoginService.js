'use strict';

/**
 * Login da ponte MTProto — QR Code (seguro). Roda em background (não trava o bot).
 */
const logger = require('../config/logger');

/** Intervalo mínimo entre atualizações do QR (Telegram renova ~30s). */
const QR_REFRESH_MIN_MS = 35000;

class BridgeLoginService {
    constructor(dbRaw) {
        this.dbRaw = dbRaw;
        /** @type {Map<number, object>} */
        this._flow = new Map();
    }

    isAwaiting(uid) {
        return this._flow.has(Number(uid));
    }

    getPendingLink(uid) {
        return this._flow.get(Number(uid))?.pendingLink || null;
    }

    async cancel(uid) {
        const s = this._flow.get(Number(uid));
        if (s?._rejectPassword) {
            s._rejectPassword(new Error('cancelled'));
        }
        s._resolvePassword = null;
        s._rejectPassword = null;
        await this._clearQrPhoto(s);
        if (s?.client) {
            const bridge = require('./TelegramUserBridge');
            await bridge.destroyClient(s.client);
        }
        this._flow.delete(Number(uid));
    }

    _bridgeUnavailableMessage() {
        return (
            '⚠️ <b>Ponte MTProto indisponível</b>\n\n' +
            'Pacote <code>telegram</code> não instalado.'
        );
    }

    _qrInstructions() {
        return (
            `📲 <b>Conectar conta (só 1ª vez)</b>\n\n` +
            `1️⃣ Telegram no celular → <b>Configurações → Dispositivos → Conectar dispositivo</b>\n` +
            `2️⃣ Escaneie o <b>QR code</b> abaixo\n\n` +
            `⚠️ <b>Não digite código SMS aqui.</b>\n` +
            `Se tiver <b>2FA</b>, envie só a <b>senha</b> (não o código SMS).\n\n` +
            `<i>A ponte só fica salva após QR + senha 2FA (se tiver).</i>\n` +
            `<i>QR expirou? <code>novo qr</code></i>`
        );
    }

    _bindNotify(s, ctx, groupService = null) {
        s.notify = {
            telegram: ctx.telegram,
            chatId: ctx.chat.id,
        };
        s.groupService = groupService;
    }

    async _notify(s, text, extra = {}) {
        if (!s?.notify?.telegram || !s.notify.chatId) return;
        try {
            await s.notify.telegram.sendMessage(s.notify.chatId, text, {
                parse_mode: 'HTML',
                ...extra,
            });
        } catch (e) {
            logger.warn('[BridgeLogin] notify:', e.message);
        }
    }

    /**
     * @returns {{ started: boolean, already?: boolean, unavailable?: boolean, method?: string, message: string }}
     */
    start(uid, { pendingLink = null } = {}) {
        const bridge = require('./TelegramUserBridge');

        if (!bridge.canUseBridge()) {
            return { started: false, unavailable: true, message: this._bridgeUnavailableMessage() };
        }

        if (bridge.isConfigured()) {
            return {
                started: false,
                already: true,
                message: '✅ Ponte já conectada. Use <code>/entrar LINK</code>.',
            };
        }

        const step = bridge.hasCredentials() ? 'qr' : 'api_id';

        const nuid = Number(uid);
        const existing = this._flow.get(nuid);
        if (existing) {
            if (pendingLink) existing.pendingLink = String(pendingLink).trim();
            const active = existing.qrRunning || existing.client || existing._authTask;
            if (active) {
                const msg =
                    existing.step === 'password'
                        ? '🔐 <b>QR já escaneado</b> — falta a <b>senha 2FA</b>.\n\n' +
                          '<i>A ponte só fica salva depois da senha. Não gere QR de novo.</i>'
                        : '📲 QR já enviado — escaneie no Telegram ou digite <code>novo qr</code> se expirou.';
                return { started: true, method: 'qr', message: msg, resumed: true };
            }
            this._flow.delete(nuid);
        }

        this._flow.set(nuid, {
            step,
            pendingLink: pendingLink ? String(pendingLink).trim() : null,
            client: null,
            apiId: null,
            qrRunning: false,
            passwordPromptSent: false,
            passwordVerifying: false,
            qrMessageId: null,
            lastQrToken: null,
            lastQrSentAt: 0,
            _authTask: null,
            _resolvePassword: null,
            _rejectPassword: null,
            notify: null,
            groupService: null,
        });

        if (step === 'api_id') {
            return {
                started: true,
                method: 'api',
                message: `🔌 Envie o <b>API ID</b> (my.telegram.org).\n<i>/cancelar para abortar</i>`,
            };
        }

        return { started: true, method: 'qr', message: this._qrInstructions() };
    }

    _errMsg(e) {
        return e?.errorMessage || e?.message || String(e);
    }

    _tokenToLoginUrl(token) {
        const buf = Buffer.isBuffer(token) ? token : Buffer.from(token);
        return `tg://login?token=${buf.toString('base64url')}`;
    }

    _qrImageUrl(tgUrl) {
        return `https://api.qrserver.com/v1/create-qr-code/?size=420x420&data=${encodeURIComponent(tgUrl)}`;
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

    async _sendQrPhoto(s, tgUrl, { tokenKey = null, force = false } = {}) {
        if (!s?.notify?.telegram || !s.notify.chatId) return;

        const now = Date.now();
        if (!force && tokenKey && tokenKey === s.lastQrToken) return;
        if (!force && s.lastQrSentAt && now - s.lastQrSentAt < QR_REFRESH_MIN_MS) return;

        s.lastQrToken = tokenKey || s.lastQrToken;
        s.lastQrSentAt = now;

        const caption =
            '📷 <b>Escaneie no Telegram</b>\n' +
            'Configurações → Dispositivos → Conectar dispositivo\n\n' +
            '<i>O QR renova sozinho a cada ~30s — esta mensagem será atualizada.</i>';
        const qrUrl = this._qrImageUrl(tgUrl);
        const { telegram, chatId } = s.notify;

        try {
            if (s.qrMessageId) {
                try {
                    await telegram.editMessageMedia(
                        chatId,
                        s.qrMessageId,
                        undefined,
                        { type: 'photo', media: qrUrl, caption, parse_mode: 'HTML' }
                    );
                    return;
                } catch {
                    await telegram.deleteMessage(chatId, s.qrMessageId).catch(() => {});
                    s.qrMessageId = null;
                }
            }

            const sent = await telegram.sendPhoto(
                chatId,
                { url: qrUrl },
                { caption, parse_mode: 'HTML' }
            );
            s.qrMessageId = sent?.message_id ?? null;
        } catch {
            await this._notify(
                s,
                `🔗 <a href="${tgUrl}">Abrir link de login</a>\n\n${caption}`
            );
        }
    }

    /**
     * Inicia QR em background — retorna imediatamente (evita handler timeout).
     */
    launchQr(uid, ctx, { groupService = null, background = true } = {}) {
        const s = this._flow.get(Number(uid));
        if (!s || s.step !== 'qr') return { ok: false, message: 'Fluxo QR inativo.' };
        if (s._authTask || s.qrRunning) {
            return { ok: true, launched: false, message: 'QR já em andamento.' };
        }

        this._bindNotify(s, ctx, groupService);
        s.qrRunning = true;
        if (s.step !== 'password') {
            s.passwordPromptSent = false;
            s.passwordVerifying = false;
        }

        const run = () => this._runQrAuth(uid, s);

        if (background) {
            setImmediate(() => {
                s._authTask = run()
                    .catch((e) => {
                        logger.error('[BridgeLogin] QR bg:', this._errMsg(e));
                    })
                    .finally(() => {
                        s._authTask = null;
                        s.qrRunning = false;
                    });
            });
            return { ok: true, launched: true };
        }

        return run();
    }

    async _runQrAuth(uid, s) {
        const bridge = require('./TelegramUserBridge');
        const creds = bridge.getCredentials();
        if (!creds) {
            s.qrRunning = false;
            await this._notify(s, '❌ Credenciais API ausentes no .env.');
            return { ok: false };
        }

        if (s.client) {
            await bridge.destroyClient(s.client);
            s.client = null;
        }

        let client = null;
        try {
            const { TelegramClient } = require('telegram');
            const { StringSession } = require('telegram/sessions');
            client = new TelegramClient(
                new StringSession(''),
                creds.apiId,
                creds.apiHash,
                bridge.getClientOptions({ forLogin: true })
            );
            await client.connect();
            s.client = client;

            let qrUpdates = 0;
            await client.signInUserWithQrCode(
                { apiId: creds.apiId, apiHash: creds.apiHash },
                {
                    qrCode: async ({ token, expires }) => {
                        const tokenKey = Buffer.isBuffer(token)
                            ? token.toString('base64url')
                            : String(token);
                        const tgUrl = this._tokenToLoginUrl(token);
                        const isFirst = qrUpdates === 0;
                        qrUpdates += 1;
                        await this._sendQrPhoto(s, tgUrl, {
                            tokenKey,
                            force: isFirst,
                        });
                        if (expires) {
                            logger.debug('[BridgeLogin] QR token expira em', expires, 's');
                        }
                    },
                    password: async (hint) => {
                        s.step = 'password';
                        s.passwordVerifying = false;
                        await this._clearQrPhoto(s);
                        const hintTxt = hint ? `\n<i>Dica: ${hint}</i>` : '';
                        if (!s.passwordPromptSent) {
                            s.passwordPromptSent = true;
                            await this._notify(
                                s,
                                `✅ <b>QR escaneado!</b>\n\n` +
                                    `🔐 Agora envie sua <b>senha 2FA</b> do Telegram (não o código SMS).` +
                                    `\n\n<i>Só depois disso a ponte fica salva — não precisa escanear de novo.</i>${hintTxt}`
                            );
                        } else {
                            await this._notify(
                                s,
                                `❌ <b>Senha incorreta.</b> Tente novamente:${hintTxt}`
                            );
                        }
                        return new Promise((resolve, reject) => {
                            s._resolvePassword = resolve;
                            s._rejectPassword = reject;
                            if (s._passwordTimer) clearTimeout(s._passwordTimer);
                            s._passwordTimer = setTimeout(() => {
                                reject(new Error('Tempo esgotado — digite /conectar de novo.'));
                            }, 600000);
                        });
                    },
                    onError: async (err) => {
                        logger.warn('[BridgeLogin] QR onError:', this._errMsg(err));
                        return false;
                    },
                }
            );

            if (s._passwordTimer) clearTimeout(s._passwordTimer);
            s._resolvePassword = null;
            s._rejectPassword = null;

            const result = await this._finish(uid, s);
            await this._notify(s, result.message);
            if (result.pendingLink) {
                await this._runPendingJoin(s, result.pendingLink);
            }
            try {
                const { getBridgePoolService } = require('./BridgePoolService');
                const pool = getBridgePoolService({
                    dbRaw: this.dbRaw,
                    groupService: s.groupService,
                    telegram: s.notify?.telegram,
                });
                pool.startMaintenance();
                await pool.startLinkWatcher();
                pool.scheduleProcess();
            } catch (e) {
                logger.debug('[BridgeLogin] pool start:', e.message);
            }
            return { ok: true, ...result };
        } catch (e) {
            if (s._passwordTimer) clearTimeout(s._passwordTimer);
            s.qrRunning = false;
            s.passwordPromptSent = false;
            s.passwordVerifying = false;
            s._resolvePassword = null;
            s._rejectPassword = null;
            const msg = this._errMsg(e);
            const friendly =
                /PASSWORD_HASH_INVALID|password/i.test(msg)
                    ? 'Senha 2FA incorreta.'
                    : msg;
            logger.warn('[BridgeLogin] QR:', msg);
            if (client && client !== s.client) await bridge.destroyClient(client);
            await this._clearQrPhoto(s);
            await this._notify(
                s,
                `❌ Login falhou: ${friendly}\n\nDigite <code>/conectar</code> ou <code>novo qr</code>.`
            );
            return { ok: false, message: friendly };
        }
    }

    async _runPendingJoin(s, pendingLink) {
        try {
            const { getBridgePoolService } = require('./BridgePoolService');
            const pool = getBridgePoolService({
                dbRaw: this.dbRaw,
                groupService: s.groupService,
                telegram: s.notify?.telegram,
            });
            const r = pool.handleIncomingText(pendingLink, { source: 'post_login' });
            await pool.processQueue();
            const stats = pool.getQueueStats();
            await this._notify(
                s,
                `⏳ <b>Fila ponte</b>\n\n` +
                    `${r.queued || 0} link(s) processado(s)\n` +
                    `📡 Ativos: ${stats.active}/${stats.max}`
            );
        } catch (e) {
            logger.warn('[BridgeLogin] pending join:', e.message);
            try {
                const { JoinChatService } = require('./JoinChatService');
                const joiner = new JoinChatService(s.notify.telegram, s.groupService);
                const batch = await joiner.joinFromText(pendingLink);
                const summary = JoinChatService.formatSummary(batch);
                await this._notify(s, summary.text);
            } catch (e2) {
                await this._notify(s, `❌ Erro ao entrar: ${e2.message}`);
            }
        }
    }

    async handleText(uid, text) {
        const s = this._flow.get(Number(uid));
        if (!s) return null;

        const raw = String(text || '').trim();
        if (!raw) return { handled: true, message: '❌ Valor inválido ou /cancelar.' };

        const bridge = require('./TelegramUserBridge');

        try {
            if (s._resolvePassword) {
                if (/^\d{5,6}$/.test(raw)) {
                    return {
                        handled: true,
                        message:
                            '⚠️ Isso parece um <b>código SMS</b>, não a senha 2FA.\n\n' +
                            'A senha 2FA é a que você definiu em <b>Privacidade → Verificação em duas etapas</b> ' +
                            '(pode ter letras e números, não é o código de 5 dígitos do SMS).',
                    };
                }
                if (s.passwordVerifying) {
                    return {
                        handled: true,
                        message: '⏳ Ainda verificando a senha — aguarde alguns segundos.',
                    };
                }
                clearTimeout(s._passwordTimer);
                s.passwordVerifying = true;
                const resolve = s._resolvePassword;
                s._resolvePassword = null;
                s._rejectPassword = null;
                resolve(raw);
                return { handled: true, message: '⏳ Verificando senha…' };
            }

            if (/^cancelar\s+ponte$/i.test(raw)) {
                await this._clearQrPhoto(s);
                if (s._rejectPassword) s._rejectPassword(new Error('cancelled'));
                if (s.client) await bridge.destroyClient(s.client);
                this._flow.delete(Number(uid));
                return {
                    handled: true,
                    message: '🛑 Conexão da ponte cancelada.\n\nDigite <code>/conectar</code> para recomeçar.',
                };
            }

            if ((s.step === 'qr' || s.step === 'password') && /^novo\s*qr$/i.test(raw)) {
                if (s.step === 'password') {
                    return {
                        handled: true,
                        message:
                            '🔐 Você já escaneou o QR — envie a <b>senha 2FA</b> para concluir.\n\n' +
                            'Para recomeçar do zero: <code>cancelar ponte</code>',
                    };
                }
                if (s._rejectPassword) s._rejectPassword(new Error('novo qr'));
                s.qrRunning = false;
                s.passwordPromptSent = false;
                s.passwordVerifying = false;
                s.lastQrToken = null;
                s.lastQrSentAt = 0;
                if (s.client) {
                    await bridge.destroyClient(s.client);
                    s.client = null;
                }
                await this._clearQrPhoto(s);
                s.step = 'qr';
                return {
                    handled: true,
                    needQrLaunch: true,
                    message: this._qrInstructions(),
                };
            }

            if (s.step === 'qr' && s.qrRunning) {
                return {
                    handled: true,
                    message: '📲 Escaneie o QR ou aguarde. Se expirou: <code>novo qr</code>',
                };
            }

            if (s.step === 'password' && s.qrRunning) {
                if (s.passwordVerifying) {
                    return {
                        handled: true,
                        message: '⏳ Verificação em andamento — aguarde.',
                    };
                }
                return { handled: true, silent: true };
            }

            if (s.step === 'api_id') {
                const apiId = parseInt(raw.replace(/\D/g, ''), 10);
                if (!apiId || apiId < 1000) {
                    return { handled: true, message: '❌ API ID inválido.' };
                }
                s.apiId = apiId;
                s.step = 'api_hash';
                return { handled: true, message: '✅ Agora envie o <b>API Hash</b>:' };
            }

            if (s.step === 'api_hash') {
                const hash = raw.replace(/\s/g, '');
                if (hash.length < 16) {
                    return { handled: true, message: '❌ API Hash inválido.' };
                }
                bridge.saveCredentials(s.apiId, hash);
                s.step = 'qr';
                return {
                    handled: true,
                    needQrLaunch: true,
                    message: '✅ Credenciais salvas.\n\n' + this._qrInstructions(),
                };
            }
        } catch (e) {
            logger.error('[BridgeLogin] handleText:', this._errMsg(e));
            await this.cancel(uid);
            return {
                handled: true,
                message: `❌ Erro: ${this._errMsg(e)}\n\n<code>/conectar</code> para recomeçar.`,
            };
        }

        return null;
    }

    async _finish(uid, s) {
        const bridge = require('./TelegramUserBridge');
        const { persistSessionToEnv, clearSetupNotified } = require('./BridgeAutoService');
        const sessionStr = s.client.session.save();
        bridge.saveSession(sessionStr);
        persistSessionToEnv(sessionStr);
        if (this.dbRaw) clearSetupNotified(this.dbRaw);
        await bridge.resetClient();
        const pendingLink = s.pendingLink;
        await bridge.destroyClient(s.client);
        s.qrRunning = false;
        await this._clearQrPhoto(s);
        this._flow.delete(Number(uid));

        logger.info('[BridgeLogin] sessão salva', { uid });

        return {
            handled: true,
            connected: true,
            pendingLink,
            message:
                '✅ <b>Conta conectada!</b>\n\n' +
                'Ponte ativa — <code>/entrar LINK</code> funciona em links <code>+</code>.',
        };
    }
}

let _singleton = null;
function getBridgeLoginService(dbRaw) {
    if (!_singleton) _singleton = new BridgeLoginService(dbRaw);
    return _singleton;
}

module.exports = { BridgeLoginService, getBridgeLoginService };
