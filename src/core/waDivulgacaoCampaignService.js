'use strict';

const fs = require('fs');
const path = require('path');
const { deferBackground } = require('../../utils/defer');
const WaDivulgacaoConfig = require('./waDivulgacaoConfig');
const { getWaDivulgacaoClient } = require('./waDivulgacaoClient');
const { ensureUserWorkerReady } = require('./waDivulgacaoWorkerService');
const logger = require('../../config/logger');
const {
    getUserSettings,
    saveUserSettings,
    addTemplate,
    addGroupList,
    getGroupList,
    appendHistory,
    updateHistoryEntry,
    historyTotals,
    getHistory,
} = require('./waDivulgacaoStore');
const { scheduleWaDivCampaign } = require('../queue/QueueHelpers');
const { CAMPAIGN_PRESETS, getPreset } = require('./waDivulgacaoPresets');
const { listPendingCampaigns, cancelCampaignJob } = require('./waDivulgacaoScheduleService');
const { stageMessageMedia } = require('./waDivulgacaoMediaHelper');
const { resolveUserSession } = require('./waDivulgacaoUserSession');

const SESSION_TTL_MS = 30 * 60 * 1000;
const GROUPS_PER_PAGE = 6;
const HISTORY_PER_PAGE = 5;
const PACE_DELAYS = { slow: 60000, normal: 15000, fast: 5000 };

class WaDivulgacaoCampaignService {
    constructor() {
        this._sessions = new Map();
    }

    _key(telegramId) {
        return String(telegramId);
    }

    _sessionFile(telegramId) {
        const { sessionDir } = resolveUserSession(telegramId);
        return path.join(sessionDir, 'campaign-draft.json');
    }

    _serializeSession(session) {
        if (!session) return null;
        return {
            ...session,
            selected: session.selected instanceof Set ? [...session.selected] : session.selected || [],
        };
    }

    _hydrateSession(raw) {
        if (!raw || typeof raw !== 'object') return null;
        const session = { ...raw };
        if (Array.isArray(session.selected)) {
            session.selected = new Set(session.selected);
        } else if (!(session.selected instanceof Set)) {
            session.selected = new Set();
        }
        return session;
    }

    _persistSession(telegramId, session) {
        const file = this._sessionFile(telegramId);
        try {
            fs.mkdirSync(path.dirname(file), { recursive: true });
            if (!session) {
                try {
                    fs.unlinkSync(file);
                } catch {
                    /* ignore */
                }
                return;
            }
            fs.writeFileSync(file, JSON.stringify(this._serializeSession(session), null, 2));
        } catch (e) {
            logger.warn('[WaDivulgacao] campaign session persist failed', {
                telegramId,
                error: e?.message,
            });
        }
    }

    _loadPersistedSession(telegramId) {
        const file = this._sessionFile(telegramId);
        try {
            const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (!raw?.step || Date.now() - (raw.at || 0) > SESSION_TTL_MS) {
                try {
                    fs.unlinkSync(file);
                } catch {
                    /* ignore */
                }
                return null;
            }
            return this._hydrateSession(raw);
        } catch {
            return null;
        }
    }

    _setSession(telegramId, session) {
        const key = this._key(telegramId);
        if (!session) {
            this._sessions.delete(key);
            this._persistSession(telegramId, null);
            return;
        }
        this._sessions.set(key, session);
        this._persistSession(telegramId, session);
    }

    _touchSession(telegramId) {
        const s = this.getSession(telegramId);
        if (!s) return;
        s.at = Date.now();
        this._persistSession(telegramId, s);
    }

    _prune() {
        const now = Date.now();
        for (const [k, s] of this._sessions.entries()) {
            if (now - (s.at || 0) > SESSION_TTL_MS) {
                this._sessions.delete(k);
                this._persistSession(k, null);
            }
        }
    }

    getSession(telegramId) {
        this._prune();
        const key = this._key(telegramId);
        let session = this._sessions.get(key);
        if (!session) {
            session = this._loadPersistedSession(telegramId);
            if (session) this._sessions.set(key, session);
        }
        return session || null;
    }

    clearSession(telegramId) {
        this._setSession(telegramId, null);
    }

    isAwaitingText(telegramId) {
        return this.getSession(telegramId)?.step === 'await_text';
    }

    hasActiveSession(telegramId) {
        return Boolean(this.getSession(telegramId)?.step);
    }

    static SESSION_EXPIRED_MSG =
        '⏱ <b>Sessão expirada</b>\n\nAbra <b>📣 Campanhas</b> e comece novamente.';

    _parseGroupsFromIpc(listed) {
        if (!listed) {
            return {
                ok: false,
                groups: [],
                message: '⚠️ <b>WhatsApp sem resposta</b>\n\nTente <b>📱 Conectar</b> e aguarde ~30s.',
            };
        }
        if (listed.ok === false) {
            return {
                ok: false,
                groups: [],
                message:
                    listed.message ||
                    listed.error ||
                    '⚠️ <b>WhatsApp offline</b>\n\nConecte em <b>📱 Conectar WhatsApp</b> e tente de novo.',
            };
        }
        const groups = listed?.result?.groups || listed?.groups || [];
        return { ok: true, groups };
    }

    appendWatermark(text) {
        const wm = String(WaDivulgacaoConfig.watermarkDefault || '').trim();
        const base = String(text || '').trim();
        if (!wm || !base) return base || wm;
        if (base.includes(wm)) return base;
        return `${base}\n\n${wm}`;
    }

    async _guardWorker(telegramId) {
        const boot = await ensureUserWorkerReady(telegramId);
        if (!boot.ok) {
            return {
                ok: false,
                message:
                    boot.message ||
                    '⚠️ Serviço WhatsApp indisponível.\nConecte primeiro em <b>📱 Conectar WhatsApp</b>.',
            };
        }
        const { client } = boot;
        const { getWaDivulgacaoLoginService } = require('./waDivulgacaoLoginService');
        const state =
            (await getWaDivulgacaoLoginService().fetchConnectionState(telegramId, client)) ||
            client.readState();
        if (!state?.connected) {
            return {
                ok: false,
                message:
                    '🔴 <b>WhatsApp não conectado</b>\n\nConecte por QR ou código antes de disparar.',
            };
        }
        return { ok: true, client, state };
    }

    _modeLabel(mode) {
        const m = String(mode || 'status');
        if (m === 'payment') return '💰 Só pagamento';
        if (m === 'status_payment') return '📲+💰 Status + pagamento';
        return '📲 Só status';
    }

    _needsCycles(mode) {
        const m = String(mode || 'status');
        return m === 'payment' || m === 'status_payment';
    }

    _isPaymentMode(mode) {
        const m = String(mode || 'status');
        return m === 'payment' || m === 'status_payment';
    }

    _isPaymentOnlyMode(mode) {
        return String(mode || '') === 'payment';
    }

    _requiresText(mode) {
        return this._isPaymentOnlyMode(mode) || this._needsCycles(mode);
    }

    _mediaAllowedForMode(mode) {
        return mode === 'status' || mode === 'status_payment';
    }

    _localHour() {
        return Number(
            new Date().toLocaleString('en-US', {
                hour: 'numeric',
                hour12: false,
                timeZone: 'America/Sao_Paulo',
            })
        );
    }

    _isWithinAllowedHours(telegramId) {
        const { allowedHours } = getUserSettings(telegramId);
        if (!allowedHours || allowedHours.start == null || allowedHours.end == null) {
            return { ok: true };
        }
        const h = this._localHour();
        const start = Number(allowedHours.start);
        const end = Number(allowedHours.end);
        const inside = start <= end ? h >= start && h < end : h >= start || h < end;
        if (inside) return { ok: true };
        return {
            ok: false,
            message:
                `⏰ <b>Fora do horário permitido</b>\n\n` +
                `Disparos liberados entre <b>${start}h</b> e <b>${end}h</b> (Brasília).\n\n` +
                `Ajuste em <b>⚙️ Configurações</b> ou agende para depois.`,
        };
    }

    _paceDelayMs(telegramId, overrideMs) {
        if (overrideMs) return overrideMs;
        const prefs = getUserSettings(telegramId);
        return PACE_DELAYS[prefs.paceMode] || prefs.defaultDelayMs || 15000;
    }

    startWizard(telegramId, preset = null) {
        const prefs = getUserSettings(telegramId);
        const p = preset ? getPreset(preset) : null;
        this._setSession(telegramId, {
            step: 'await_text',
            text: '',
            mediaStaging: null,
            mediaKind: null,
            mode: p?.mode || prefs.defaultMode || 'status',
            cycles: p?.cycles || 1,
            groups: [],
            selected: new Set(),
            page: 0,
            delayMs: p?.delayMs || this._paceDelayMs(telegramId, prefs.defaultDelayMs),
            presetId: p?.id || null,
            at: Date.now(),
        });
        const presetLine = p ? `\n<b>Modelo:</b> ${p.label} — <i>${p.hint}</i>\n` : '';
        const tplHint =
            prefs.templates?.length > 0
                ? '\n\n<i>Ou abra <b>⚙️ Configurações</b> para usar um modelo salvo.</i>'
                : '';
        return {
            message:
                '📣 <b>Nova campanha</b>\n\n' +
                presetLine +
                'Envie o <b>texto</b> e/ou <b>foto/vídeo</b> da divulgação.\n\n' +
                '<i>Mídia (foto/vídeo) só no modo <b>Status</b>. Pagamento usa apenas texto.</i>\n' +
                '<i>A assinatura do plano é adicionada automaticamente no final.</i>' +
                tplHint +
                '\n\nUse /cancelar para sair.',
        };
    }

    buildCampaignEntryPanel() {
        const rows = [];
        for (let i = 0; i < CAMPAIGN_PRESETS.length; i += 2) {
            const row = [];
            const left = CAMPAIGN_PRESETS[i];
            const right = CAMPAIGN_PRESETS[i + 1];
            if (left) row.push({ text: left.label, callback_data: `wadv:preset:${left.id}` });
            if (right) row.push({ text: right.label, callback_data: `wadv:preset:${right.id}` });
            if (row.length) rows.push(row);
        }
        rows.push([{ text: '✏️ Texto livre', callback_data: 'wadv:camp:new' }]);
        rows.push(
            [
                { text: '📋 Histórico', callback_data: 'wadv:history' },
                { text: '⏰ Agendadas', callback_data: 'wadv:scheduled' },
            ],
            [{ text: '🔙 Painel', callback_data: 'wadv:home' }]
        );

        const hints = CAMPAIGN_PRESETS.map((p) => `• ${p.label}: ${p.hint}`).join('\n');
        return {
            message:
                '📣 <b>Campanhas Hanork Div</b>\n\n' +
                'Escolha um <b>modelo rápido</b> (já define modo e delay) ou crie do zero:\n\n' +
                hints,
            keyboard: { inline_keyboard: rows },
        };
    }

    applyPreset(telegramId, presetId) {
        const p = getPreset(presetId);
        if (!p) return { ok: false, message: '❌ Modelo não encontrado.' };
        return { ok: true, panel: { message: this.startWizard(telegramId, presetId).message, keyboard: null } };
    }

    buildModePanel(telegramId) {
        const s = this.getSession(telegramId);
        if (!s?.text && !s?.mediaStaging) {
            return { message: '❌ Envie o texto ou mídia da campanha primeiro.', keyboard: null };
        }
        s.step = 'pick_mode';
        s.at = Date.now();
        this._touchSession(telegramId);
        const preview = this.appendWatermark(s.text || (s.mediaStaging ? '(mídia)' : '')).slice(0, 160);
        const mediaLine = s.mediaStaging
            ? `\n<b>Mídia:</b> ${s.mediaKind === 'video' ? '🎬 Vídeo' : '🖼 Foto'} <i>(só Status)</i>\n`
            : '';
        const payNote = s.mediaStaging
            ? '\n<i>💰 Pagamento e Status+Pagamento usam <b>só texto</b> — escolha Status para enviar mídia.</i>\n'
            : '';

        const rows = [[{ text: '📲 Só Status', callback_data: 'wadv:camp:mode:status' }]];
        if (s.text) {
            rows.push(
                [{ text: '💰 Só pagamento', callback_data: 'wadv:camp:mode:payment' }],
                [{ text: '📲+💰 Status + pagamento', callback_data: 'wadv:camp:mode:status_payment' }]
            );
        }
        rows.push(
            [{ text: '💾 Salvar como modelo', callback_data: 'wadv:camp:save_tpl' }],
            [{ text: '🔙 Cancelar', callback_data: 'wadv:camp:cancel' }]
        );

        return {
            message:
                `📣 <b>Modo de divulgação</b>\n\n` +
                mediaLine +
                `<b>Prévia:</b>\n<i>${preview}${preview.length >= 160 ? '…' : ''}</i>\n` +
                payNote +
                '\nEscolha como enviar nos grupos:',
            keyboard: { inline_keyboard: rows },
        };
    }

    async acceptText(telegramId, rawText) {
        const text = String(rawText || '').trim();
        const s0 = this.getSession(telegramId);
        if (!s0 || s0.step !== 'await_text') {
            return {
                ok: false,
                reason: 'no_session',
                message: '❌ Sessão expirada. Abra <b>📣 Campanhas</b> → <b>Texto livre</b> novamente.',
            };
        }
        if ((!text || text.startsWith('/')) && !s0?.mediaStaging) return { ok: false, reason: 'empty' };

        const s = s0;
        this._setSession(telegramId, {
            ...s,
            step: 'pick_mode',
            text: text || s.text || '',
            mode: s.mode || 'status',
            cycles: s.cycles || 1,
            groups: [],
            selected: new Set(),
            page: 0,
            delayMs: s.delayMs || 15000,
            at: Date.now(),
        });

        logger.info('[WaDivulgacao] campaign text accepted', {
            telegramId,
            chars: text.length,
            preset: s.presetId || null,
        });

        if (s.presetId) {
            return { ok: true, deferAcceptMode: true, mode: s.mode };
        }

        return { ok: true, panel: this.buildModePanel(telegramId) };
    }

    async acceptMedia(telegramId, ctx, message) {
        const s0 = this.getSession(telegramId);
        if (!s0 || s0.step !== 'await_text') {
            return {
                ok: false,
                message: '❌ Sessão expirada. Abra <b>📣 Campanhas</b> novamente.',
            };
        }

        let staged;
        try {
            staged = await stageMessageMedia(telegramId, ctx, message);
        } catch (e) {
            return { ok: false, message: `❌ Falha ao processar mídia: ${e.message || 'erro'}` };
        }
        if (!staged.ok) {
            return { ok: false, message: '❌ Envie uma foto ou vídeo válido.' };
        }

        const caption = String(message.caption || '').trim();
        const s = this.getSession(telegramId) || {};
        this._setSession(telegramId, {
            ...s,
            step: 'pick_mode',
            text: caption || s.text || '',
            mediaStaging: staged.stagingName,
            mediaKind: staged.mediaKind,
            mode: s.mode || 'status',
            cycles: s.cycles || 1,
            groups: [],
            selected: new Set(),
            page: 0,
            delayMs: s.delayMs || 15000,
            at: Date.now(),
        });

        if (s.presetId) {
            return { ok: true, deferAcceptMode: true, mode: s.mode };
        }

        return { ok: true, panel: this.buildModePanel(telegramId) };
    }

    async acceptMode(telegramId, mode) {
        const s = this.getSession(telegramId);
        if (!s?.text && !s?.mediaStaging) return { ok: false, message: '❌ Sessão expirada.' };

        const guard = await this._guardWorker(telegramId);
        if (!guard.ok) return guard;

        const { client } = guard;
        const uid = Number(telegramId);
        await client.sendCommand('wa.sync_groups', {}, uid).catch((e) => {
            logger.warn('[WaDivulgacao] sync_groups failed', { telegramId, error: e?.message });
        });
        const listed = await client.sendCommand('wa.list_groups', { limit: 80 }, uid);
        const parsed = this._parseGroupsFromIpc(listed);
        if (!parsed.ok) return { ok: false, message: parsed.message };
        const groups = parsed.groups;
        if (!groups.length) {
            return {
                ok: false,
                message: '❌ Nenhum grupo encontrado.\n\nEntre em grupos no WhatsApp e toque em <b>👥 Grupos</b> para sincronizar.',
            };
        }

        const m = ['status', 'payment', 'status_payment'].includes(mode) ? mode : 'status';

        if (this._isPaymentMode(m)) {
            if (!String(s.text || '').trim()) {
                return {
                    ok: false,
                    message:
                        '💰 <b>Modo pagamento exige texto</b>\n\n' +
                        'A mídia (foto/vídeo) só funciona em <b>📲 Só Status</b>.\n' +
                        'Envie o texto da campanha e escolha novamente.',
                };
            }
        }

        const sessionPatch = {
            ...s,
            step: 'pick_groups',
            mode: m,
            cycles: this._needsCycles(m) ? Math.max(1, s.cycles || 1) : 1,
            groups,
            selected: new Set(groups.map((_, i) => i)),
            page: 0,
            at: Date.now(),
        };
        if (this._isPaymentMode(m)) {
            sessionPatch.mediaStaging = null;
            sessionPatch.mediaKind = null;
        }

        this._setSession(telegramId, sessionPatch);

        return { ok: true, panel: this.buildGroupsPanel(telegramId) };
    }

    buildGroupsPanel(telegramId) {
        const s = this.getSession(telegramId);
        if (!s || s.step !== 'pick_groups') {
            return { message: '❌ Sessão expirada. Abra <b>📣 Campanhas</b> novamente.', keyboard: null };
        }
        const total = s.groups.length;
        const selected = s.selected.size;
        const page = Math.max(0, Math.min(s.page, Math.ceil(total / GROUPS_PER_PAGE) - 1));
        s.page = page;
        const slice = s.groups.slice(page * GROUPS_PER_PAGE, page * GROUPS_PER_PAGE + GROUPS_PER_PAGE);

        const lines = slice.map((g, i) => {
            const idx = page * GROUPS_PER_PAGE + i;
            const on = s.selected.has(idx) ? '✅' : '⬜';
            const name = String(g.subject || g.shortId || g.id || 'Grupo').slice(0, 42);
            return `${on} ${name}`;
        });

        const preview = this.appendWatermark(s.text).slice(0, 180);
        const message =
            `📣 <b>Escolha os grupos</b>\n\n` +
            `<b>Modo:</b> ${this._modeLabel(s.mode)}\n` +
            `<b>Selecionados:</b> ${selected}/${total}\n\n` +
            `${lines.join('\n') || '—'}\n\n` +
            `<b>Prévia:</b>\n<i>${preview}${preview.length >= 180 ? '…' : ''}</i>`;

        const rows = [];
        for (let i = 0; i < slice.length; i++) {
            const idx = page * GROUPS_PER_PAGE + i;
            const g = slice[i];
            const on = s.selected.has(idx);
            rows.push([
                {
                    text: `${on ? '✅' : '⬜'} ${String(g.subject || g.shortId || 'Grupo').slice(0, 28)}`,
                    callback_data: `wadv:camp:tg:${page}:${i}`,
                },
            ]);
        }

        const nav = [];
        if (page > 0) nav.push({ text: '◀️', callback_data: `wadv:camp:pg:${page - 1}` });
        if ((page + 1) * GROUPS_PER_PAGE < total) nav.push({ text: '▶️', callback_data: `wadv:camp:pg:${page + 1}` });
        if (nav.length) rows.push(nav);

        rows.push(
            [
                { text: '✅ Todos', callback_data: 'wadv:camp:all' },
                { text: '⬜ Limpar', callback_data: 'wadv:camp:none' },
            ],
            [{ text: '💾 Salvar lista', callback_data: 'wadv:camp:save_list' }],
            [{ text: '⏱ Escolher delay →', callback_data: 'wadv:camp:delay' }],
            [
                { text: '🔙 Cancelar', callback_data: 'wadv:camp:cancel' },
                { text: '🏠 Painel', callback_data: 'wadv:home' },
            ]
        );

        return { message, keyboard: { inline_keyboard: rows } };
    }

    toggleGroup(telegramId, page, localIdx) {
        const s = this.getSession(telegramId);
        if (!s || s.step !== 'pick_groups') return null;
        const idx = Number(page) * GROUPS_PER_PAGE + Number(localIdx);
        if (idx < 0 || idx >= s.groups.length) return null;
        if (s.selected.has(idx)) s.selected.delete(idx);
        else s.selected.add(idx);
        s.page = Number(page) || 0;
        s.at = Date.now();
        return this.buildGroupsPanel(telegramId);
    }

    setPage(telegramId, page) {
        const s = this.getSession(telegramId);
        if (!s) return null;
        s.page = Math.max(0, Number(page) || 0);
        s.at = Date.now();
        return this.buildGroupsPanel(telegramId);
    }

    selectAll(telegramId, mode) {
        const s = this.getSession(telegramId);
        if (!s) return null;
        if (mode === 'all') {
            s.selected = new Set(s.groups.map((_, i) => i));
        } else {
            s.selected = new Set();
        }
        s.at = Date.now();
        return this.buildGroupsPanel(telegramId);
    }


    _selectedGroups(telegramId) {
        const s = this.getSession(telegramId);
        if (!s?.groups?.length || !s.selected?.size) return [];
        return [...s.selected]
            .sort((a, b) => a - b)
            .map((i) => s.groups[i])
            .filter(Boolean);
    }

    _buildCampaignRiskHint(telegramId) {
        const s = this.getSession(telegramId);
        if (!s) return '';
        const mode = s.mode || 'status';
        if (mode === 'payment') return '';
        const groups = this._selectedGroups(telegramId);
        if (!groups.length) return '';
        const risky = groups.filter(
            (g) => g.manualJoin || (Number(g.size) > 0 && Number(g.size) < 50)
        );
        if (!risky.length) return '';
        const names = risky
            .slice(0, 3)
            .map((g) => String(g.subject || g.shortId || 'Grupo').slice(0, 24));
        let hint =
            '\n\n⚠️ <b>Atenção — status pode falhar</b>\n' +
            'Grupos pequenos ou entrada manual costumam bloquear <b>status</b>.\n' +
            'Pagamento tende a ir normalmente.';
        if (names.length) {
            hint += `\n<i>${names.join(' · ')}${risky.length > 3 ? '…' : ''}</i>`;
        }
        return hint;
    }

    _formatBlastDoneSummary(sent, groups, failed, skipped, meta = {}) {
        const g = Number(groups) || 0;
        const s = Number(sent) || 0;
        const cycles = Number(meta.cycles) || 1;
        let line = `📤 <b>${s}</b> envio${s === 1 ? '' : 's'} em <b>${g}</b> grupo${g === 1 ? '' : 's'}`;
        if (cycles > 1 && this._needsCycles(meta.mode)) {
            line += `\n🔁 ${cycles} repetições por grupo`;
        }
        if (meta.mode) line += `\n📋 ${this._modeLabel(meta.mode)}`;
        if (failed) line += `\n❌ Falhas: ${failed}`;
        if (skipped) line += `\n⏭ Pulados: ${skipped}`;
        return line;
    }

    buildDelayPanel(telegramId) {
        const s = this.getSession(telegramId);
        if (!s || !s.selected.size) {
            return { message: '❌ Selecione pelo menos um grupo.', keyboard: null };
        }
        s.step = 'pick_delay';
        s.at = Date.now();
        const n = s.selected.size;
        const modeLine = `<b>Modo:</b> ${this._modeLabel(s.mode)}\n`;
        const cyclesLine = this._needsCycles(s.mode)
            ? `<b>Repetições por grupo:</b> ${s.cycles || 1}\n`
            : '';
        const rows = [
            [
                { text: '5s', callback_data: 'wadv:camp:delay:5000' },
                { text: '15s', callback_data: 'wadv:camp:delay:15000' },
                { text: '30s', callback_data: 'wadv:camp:delay:30000' },
            ],
            [
                { text: '60s', callback_data: 'wadv:camp:delay:60000' },
                { text: '120s', callback_data: 'wadv:camp:delay:120000' },
            ],
        ];
        if (this._needsCycles(s.mode)) {
            rows.push([
                { text: '1×', callback_data: 'wadv:camp:cycles:1' },
                { text: '3×', callback_data: 'wadv:camp:cycles:3' },
                { text: '5×', callback_data: 'wadv:camp:cycles:5' },
            ]);
        }
        rows.push(
            [
                { text: '🚀 Agora', callback_data: 'wadv:camp:go' },
            ],
            [
                { text: '⏰ +30min', callback_data: 'wadv:camp:sched:1800000' },
                { text: '⏰ +1h', callback_data: 'wadv:camp:sched:3600000' },
            ],
            [
                { text: '⏰ +3h', callback_data: 'wadv:camp:sched:10800000' },
                { text: '⏰ Amanhã 9h', callback_data: 'wadv:camp:sched:tomorrow9' },
            ],
            [
                { text: '🔙 Grupos', callback_data: 'wadv:camp:back' },
            ]
        );
        return {
            message:
                `⏱ <b>Delay entre envios</b>\n\n` +
                modeLine +
                `<b>Grupos:</b> ${n}\n` +
                cyclesLine +
                `<b>Delay:</b> ${Math.round((s.delayMs || 15000) / 1000)}s entre cada grupo` +
                this._buildCampaignRiskHint(telegramId) +
                '\n\nEscolha o intervalo:',
            keyboard: { inline_keyboard: rows },
        };
    }

    setCycles(telegramId, n) {
        const s = this.getSession(telegramId);
        if (!s) return null;
        s.cycles = Math.min(5, Math.max(1, parseInt(n, 10) || 1));
        s.at = Date.now();
        return this.buildDelayPanel(telegramId);
    }

    setDelay(telegramId, ms) {
        const s = this.getSession(telegramId);
        if (!s) return null;
        s.delayMs = Math.max(3000, Math.min(300000, Number(ms) || 15000));
        s.at = Date.now();
        return this.buildDelayPanel(telegramId);
    }

    backToGroups(telegramId) {
        const s = this.getSession(telegramId);
        if (!s) return null;
        s.step = 'pick_groups';
        s.at = Date.now();
        return this.buildGroupsPanel(telegramId);
    }

    _buildLaunchPayload(telegramId) {
        const s = this.getSession(telegramId);
        if (!s || (!s.text && !s.mediaStaging) || !s.selected.size) return null;

        const groupIds = [...s.selected]
            .sort((a, b) => a - b)
            .map((i) => s.groups[i]?.id)
            .filter(Boolean);
        if (!groupIds.length) return null;

        const mode = s.mode || 'status';
        const delayMs = s.delayMs || 15000;
        const jobId = `wadv-${telegramId}-${Date.now()}`;
        const rawText = s.text || '';
        const text = rawText ? this.appendWatermark(rawText) : this.appendWatermark('');

        return {
            rawText,
            text,
            mode,
            groupIds,
            delayMs,
            cycles: s.cycles || 1,
            jobId,
            groupsCount: groupIds.length,
            stagingName: this._mediaAllowedForMode(mode) ? s.mediaStaging || null : null,
            mediaKind: this._mediaAllowedForMode(mode) ? s.mediaKind || null : null,
        };
    }

    saveCurrentGroupList(telegramId) {
        const s = this.getSession(telegramId);
        if (!s?.selected?.size) {
            return { ok: false, message: '❌ Selecione grupos antes de salvar.' };
        }
        const groupIds = [...s.selected]
            .sort((a, b) => a - b)
            .map((i) => s.groups[i]?.id)
            .filter(Boolean);
        const prefs = addGroupList(telegramId, null, groupIds);
        const name = prefs.groupLists[0]?.name || 'Lista';
        return { ok: true, message: `💾 <b>Lista salva:</b> ${name} (${groupIds.length} grupos)` };
    }

    async applyGroupList(telegramId, listId) {
        const list = getGroupList(telegramId, listId);
        if (!list?.groupIds?.length) {
            return { ok: false, message: '❌ Lista não encontrada.' };
        }

        const s0 = this.getSession(telegramId);
        if (!s0?.text && !s0?.mediaStaging) {
            return {
                ok: false,
                message: '❌ Abra <b>📣 Campanhas</b>, envie o conteúdo e depois use a lista em <b>⚙️ Configurações</b>.',
            };
        }

        const guard = await this._guardWorker(telegramId);
        if (!guard.ok) return guard;

        const { client } = guard;
        const uid = Number(telegramId);
        await client.sendCommand('wa.sync_groups', {}, uid).catch((e) => {
            logger.warn('[WaDivulgacao] sync_groups failed', { telegramId, error: e?.message });
        });
        const listed = await client.sendCommand('wa.list_groups', { limit: 80 }, uid);
        const parsed = this._parseGroupsFromIpc(listed);
        if (!parsed.ok) return { ok: false, message: parsed.message };
        const groups = parsed.groups;
        if (!groups.length) {
            return { ok: false, message: '❌ Nenhum grupo sincronizado.' };
        }

        const wanted = new Set(list.groupIds.map(String));
        const selected = new Set();
        groups.forEach((g, i) => {
            if (wanted.has(String(g.id))) selected.add(i);
        });
        if (!selected.size) {
            return { ok: false, message: '❌ Nenhum grupo da lista está disponível agora.' };
        }

        const s = this.getSession(telegramId) || {};
        this._setSession(telegramId, {
            ...s0,
            ...s,
            step: 'pick_groups',
            groups,
            selected,
            page: 0,
            at: Date.now(),
        });
        return { ok: true, panel: this.buildGroupsPanel(telegramId) };
    }

    async executeCampaign(telegramId, config, { scheduled = false } = {}) {
        const hours = this._isWithinAllowedHours(telegramId);
        if (!hours.ok && !scheduled) return hours;

        const guard = await this._guardWorker(telegramId);
        if (!guard.ok) return guard;

        const { client } = guard;
        const uid = Number(telegramId);
        const jobId = config.jobId || `wadv-${telegramId}-${Date.now()}`;
        const finalText = config.text || this.appendWatermark(config.rawText || '');
        const delayMs = config.delayMs || 15000;
        const groupIds = config.groupIds || [];
        const mode = config.mode || 'status';

        if (!groupIds.length) {
            return { ok: false, message: '❌ Nenhum grupo válido.' };
        }
        if (!finalText && !config.stagingName) {
            return { ok: false, message: '❌ Campanha sem conteúdo.' };
        }

        await client.sendCommand('wa.set_delay', { kind: 'post', ms: delayMs }, uid).catch(() => {});

        const ipcCmd = mode === 'status' ? 'wa.custom_blast' : 'wa.div_blast';
        const ipcArgs = {
            text: finalText,
            groupIds,
            jobId,
            force: false,
            noDelay: false,
            delayMs,
        };
        if (config.stagingName && this._mediaAllowedForMode(mode)) {
            ipcArgs.stagingName = config.stagingName;
        }
        if (mode !== 'status') {
            ipcArgs.mode = mode;
            ipcArgs.cycles = config.cycles || 1;
        }

        const ack = await client.sendCommand(ipcCmd, ipcArgs, uid);
        if (!ack?.ok) {
            appendHistory(telegramId, {
                jobId,
                mode,
                groups: groupIds.length,
                status: 'failed',
                scheduled,
                error: ack?.message || ack?.error || 'erro',
            });
            return {
                ok: false,
                message: `❌ Falha ao iniciar: ${ack?.message || ack?.error || 'erro desconhecido'}`,
            };
        }

        const started = ack.result || {};
        appendHistory(telegramId, {
            jobId,
            mode,
            groups: groupIds.length,
            total: started.total || groupIds.length,
            status: 'running',
            scheduled,
            delayMs,
            cycles: config.cycles || 1,
        });

        return {
            ok: true,
            message:
                `🚀 <b>Campanha iniciada!</b>\n\n` +
                `<b>Modo:</b> ${this._modeLabel(mode)}\n` +
                `📤 <b>Grupos:</b> ${groupIds.length}\n` +
                (this._needsCycles(mode) ? `🔁 <b>Repetições:</b> ${config.cycles || 1}×\n` : '') +
                `⏱ <b>Delay:</b> ${Math.round(delayMs / 1000)}s`,
            jobId,
            total: started.total || groupIds.length,
            mode,
            groupIds,
            delayMs,
            cycles: config.cycles || 1,
        };
    }

    _resolveScheduleMs(raw) {
        if (raw === 'tomorrow9') {
            const d = new Date();
            d.setDate(d.getDate() + 1);
            d.setHours(9, 0, 0, 0);
            const ms = d.getTime() - Date.now();
            return ms > 60000 ? ms : ms + 86400000;
        }
        return Math.max(60000, Number(raw) || 0);
    }

    async scheduleLaunch(telegramId, scheduleRaw, ctx) {
        const guard = await this._guardWorker(telegramId);
        if (!guard.ok) return guard;

        const payload = this._buildLaunchPayload(telegramId);
        if (!payload) {
            return { ok: false, message: '❌ Campanha incompleta. Comece de novo em <b>📣 Campanhas</b>.' };
        }

        const delayMs = this._resolveScheduleMs(scheduleRaw);
        const sched = await scheduleWaDivCampaign(
            telegramId,
            {
                rawText: payload.rawText,
                text: payload.text,
                mode: payload.mode,
                groupIds: payload.groupIds,
                delayMs: payload.delayMs,
                cycles: payload.cycles,
                jobId: payload.jobId,
                stagingName: payload.stagingName,
            },
            delayMs
        );

        if (!sched.scheduled) {
            return {
                ok: false,
                message:
                    sched.message ||
                    '❌ Agendamento indisponível.\n\nConfigure <b>REDIS_URL</b> ou dispare agora com <b>🚀 Agora</b>.',
            };
        }

        const runAt = new Date(sched.runAt || Date.now() + delayMs);
        const when = runAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

        appendHistory(telegramId, {
            jobId: payload.jobId,
            mode: payload.mode,
            groups: payload.groupsCount,
            status: 'scheduled',
            scheduled: true,
            runAt: runAt.toISOString(),
            delayMs: payload.delayMs,
            cycles: payload.cycles,
        });

        this.clearSession(telegramId);

        return {
            ok: true,
            message:
                `⏰ <b>Campanha agendada!</b>\n\n` +
                `<b>Modo:</b> ${this._modeLabel(payload.mode)}\n` +
                `📤 <b>Grupos:</b> ${payload.groupsCount}\n` +
                `⏱ <b>Delay entre envios:</b> ${Math.round(payload.delayMs / 1000)}s\n` +
                `📅 <b>Disparo:</b> ${when}\n\n` +
                `<i>Você receberá o resultado quando concluir.</i>`,
        };
    }

    async launch(telegramId, ctx) {
        const hours = this._isWithinAllowedHours(telegramId);
        if (!hours.ok) return hours;

        const payload = this._buildLaunchPayload(telegramId);
        if (!payload) {
            return { ok: false, message: '❌ Campanha incompleta. Comece de novo em <b>📣 Campanhas</b>.' };
        }

        const r = await this.executeCampaign(telegramId, payload);
        if (!r.ok) return r;

        this.clearSession(telegramId);

        const { client } = getWaDivulgacaoClient(telegramId);
        const uid = Number(telegramId);
        deferBackground(`wadv-blast-${r.jobId}`, () =>
            this.notifyBlastDone(ctx, client, uid, r.jobId, payload.groupsCount, {
                mode: payload.mode,
                cycles: payload.cycles,
            })
        );

        return {
            ok: true,
            message: `${r.message}\n\n<i>Aguarde — o resultado chega em instantes…</i>`,
            jobId: r.jobId,
            total: r.total,
        };
    }

    async notifyBlastDone(ctx, client, uid, jobId, expectedTotal, meta = {}) {
        const deadline = Date.now() + 180000;
        let offset = 0;

        while (Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 2500));
            let batch;
            try {
                batch = await client.readEventsSince(offset);
            } catch {
                continue;
            }
            const events = batch?.events || [];
            offset = batch?.nextOffset ?? offset;
            if (!events.length) continue;

            for (const ev of events) {
                if (ev?.type !== 'wa.post' && ev?.type !== 'post') continue;
                if (jobId && ev.jobId && ev.jobId !== jobId) continue;
                const sent = Number(ev.sent) || 0;
                const total = Number(ev.total) || expectedTotal;
                const failed = Number(ev.failed) || 0;
                const skipped = Number(ev.skipped) || 0;
                const txt =
                    `✅ <b>Campanha concluída</b>\n\n` +
                    (meta.scheduled ? `⏰ <i>Agendada</i>\n\n` : '') +
                    this._formatBlastDoneSummary(sent, expectedTotal, failed, skipped, meta);

                appendHistory(uid, {
                    jobId,
                    mode: meta.mode,
                    groups: expectedTotal,
                    sent,
                    failed,
                    skipped,
                    total,
                    status: 'done',
                    scheduled: Boolean(meta.scheduled),
                    cycles: meta.cycles,
                });

                try {
                    await ctx.telegram.sendMessage(uid, txt, { parse_mode: 'HTML' });
                } catch {
                    /* ignore */
                }
                return;
            }
        }

        try {
            await ctx.telegram.sendMessage(
                uid,
                '⏳ <b>Campanha ainda em andamento</b>\n\n' +
                    'Não recebemos confirmação em 3 minutos.\n' +
                    'Veja <b>📋 Histórico</b> ou <b>📊 Estatísticas</b> no painel Hanork Div.',
                { parse_mode: 'HTML' }
            );
        } catch (e) {
            logger.warn('[WaDivulgacao] blast timeout notify failed', { uid, jobId, error: e?.message });
        }
    }

    saveCurrentTemplate(telegramId) {
        const s = this.getSession(telegramId);
        if (!s?.text) return { ok: false, message: '❌ Nenhum texto para salvar.' };
        const prefs = addTemplate(telegramId, s.text);
        return {
            ok: true,
            message: `💾 <b>Modelo salvo!</b>\n\nTotal de modelos: <b>${prefs.templates.length}</b>`,
        };
    }

    applyTemplate(telegramId, index) {
        const prefs = getUserSettings(telegramId);
        const text = prefs.templates[Number(index)];
        if (!text) return { ok: false, message: '❌ Modelo não encontrado.' };

        const s = this.getSession(telegramId) || {};
        this._setSession(telegramId, {
            ...s,
            step: 'pick_mode',
            text,
            mode: s.mode || prefs.defaultMode || 'status',
            cycles: s.cycles || 1,
            groups: [],
            selected: new Set(),
            page: 0,
            delayMs: s.delayMs || prefs.defaultDelayMs || 15000,
            at: Date.now(),
        });
        return { ok: true, panel: this.buildModePanel(telegramId) };
    }

    buildSettingsPanel(telegramId) {
        const prefs = getUserSettings(telegramId);
        const tplLines =
            prefs.templates.length > 0
                ? prefs.templates
                      .map((t, i) => `${i + 1}. <i>${String(t).slice(0, 48)}${t.length > 48 ? '…' : ''}</i>`)
                      .join('\n')
                : '<i>Nenhum modelo salvo ainda.</i>';

        const listLines =
            prefs.groupLists.length > 0
                ? prefs.groupLists.map((l) => `• <b>${l.name}</b> (${l.groupIds.length} GP)`).join('\n')
                : '<i>Nenhuma lista salva.</i>';

        const hoursLabel = prefs.allowedHours
            ? `${prefs.allowedHours.start}h–${prefs.allowedHours.end}h`
            : '24h';
        const paceLabel =
            prefs.paceMode === 'slow' ? '🐢 Lento' : prefs.paceMode === 'fast' ? '⚡ Rápido' : '⚖️ Normal';

        const { getWaDivulgacaoLoginService } = require('./waDivulgacaoLoginService');
        const conn = getWaDivulgacaoLoginService().readConnectionState(telegramId);

        const rows = [];
        if (conn?.connected) {
            rows.push([{ text: '🔌 Desconectar WhatsApp', callback_data: 'wadv:disconnect' }]);
        } else {
            rows.push([{ text: '📱 Conectar WhatsApp', callback_data: 'wadv:connect' }]);
        }
        rows.push(
            [
                { text: '🐢 Lento', callback_data: 'wadv:settings:pace:slow' },
                { text: '⚖️ Normal', callback_data: 'wadv:settings:pace:normal' },
                { text: '⚡ Rápido', callback_data: 'wadv:settings:pace:fast' },
            ],
            [
                { text: '🕐 24h', callback_data: 'wadv:settings:hours:24' },
                { text: '🕗 8h–22h', callback_data: 'wadv:settings:hours:8-22' },
            ],
            [
                { text: '5s', callback_data: 'wadv:settings:delay:5000' },
                { text: '15s', callback_data: 'wadv:settings:delay:15000' },
                { text: '30s', callback_data: 'wadv:settings:delay:30000' },
            ],
            [
                { text: '📲 Status', callback_data: 'wadv:settings:mode:status' },
                { text: '💰 Pagamento', callback_data: 'wadv:settings:mode:payment' },
            ],
            [{ text: '📲+💰 Ambos', callback_data: 'wadv:settings:mode:status_payment' }]
        );

        for (let i = 0; i < prefs.templates.length; i++) {
            rows.push([{ text: `📄 Modelo ${i + 1}`, callback_data: `wadv:tpl:${i}` }]);
        }
        for (const list of prefs.groupLists) {
            rows.push([{ text: `👥 ${list.name}`, callback_data: `wadv:grp:list:${list.id}` }]);
        }

        rows.push(
            [{ text: '🔙 Painel', callback_data: 'wadv:home' }],
            [{ text: '🏠 Menu', callback_data: 'menu:home' }]
        );

        return {
            message:
                `⚙️ <b>Configurações Hanork Div</b>\n\n` +
                `<b>Ritmo:</b> ${paceLabel}\n` +
                `<b>Horário:</b> ${hoursLabel} (Brasília)\n` +
                `<b>Delay padrão:</b> ${Math.round(prefs.defaultDelayMs / 1000)}s\n` +
                `<b>Modo padrão:</b> ${this._modeLabel(prefs.defaultMode)}\n\n` +
                `<b>Modelos de texto:</b>\n${tplLines}\n\n` +
                `<b>Listas de grupos:</b>\n${listLines}\n\n` +
                `<i>Salve listas na seleção de grupos da campanha.</i>`,
            keyboard: { inline_keyboard: rows },
        };
    }

    setSettingsPace(telegramId, pace) {
        const p = ['slow', 'normal', 'fast'].includes(pace) ? pace : 'normal';
        const delay = PACE_DELAYS[p];
        saveUserSettings(telegramId, { paceMode: p, defaultDelayMs: delay });
        return this.buildSettingsPanel(telegramId);
    }

    setSettingsHours(telegramId, raw) {
        if (raw === '24') {
            saveUserSettings(telegramId, { allowedHours: null });
        } else if (raw === '8-22') {
            saveUserSettings(telegramId, { allowedHours: { start: 8, end: 22 } });
        }
        return this.buildSettingsPanel(telegramId);
    }

    setSettingsDelay(telegramId, ms) {
        saveUserSettings(telegramId, { defaultDelayMs: Math.max(3000, Math.min(300000, Number(ms) || 15000)) });
        return this.buildSettingsPanel(telegramId);
    }

    setSettingsMode(telegramId, mode) {
        const m = ['status', 'payment', 'status_payment'].includes(mode) ? mode : 'status';
        saveUserSettings(telegramId, { defaultMode: m });
        return this.buildSettingsPanel(telegramId);
    }

    buildHistoryPanel(telegramId, page = 0) {
        const rows = getHistory(telegramId);
        const total = rows.length;
        const maxPage = Math.max(0, Math.ceil(total / HISTORY_PER_PAGE) - 1);
        const pg = Math.max(0, Math.min(Number(page) || 0, maxPage));
        const slice = rows.slice(pg * HISTORY_PER_PAGE, pg * HISTORY_PER_PAGE + HISTORY_PER_PAGE);

        const lines =
            slice.length > 0
                ? slice
                      .map((r) => {
                          const when = r.at
                              ? new Date(r.at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
                              : '—';
                          const icon =
                              r.status === 'done'
                                  ? '✅'
                                  : r.status === 'scheduled'
                                    ? '⏰'
                                    : r.status === 'cancelled'
                                      ? '🚫'
                                      : r.status === 'failed'
                                        ? '❌'
                                        : '🔄';
                          let detail = `${r.groups || '?'} grupos`;
                          if (r.status === 'done') {
                              detail = `${r.sent || 0}/${r.total || r.groups || '?'} env.`;
                              if (r.failed) detail += ` · ${r.failed} falhas`;
                          } else if (r.status === 'scheduled' && r.runAt) {
                              detail = `para ${new Date(r.runAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`;
                          }
                          return `${icon} <b>${when}</b>\n   ${this._modeLabel(r.mode)} · ${detail}`;
                      })
                      .join('\n\n')
                : '<i>Nenhuma campanha registrada ainda.</i>';

        const kb = [];
        const nav = [];
        if (pg > 0) nav.push({ text: '◀️', callback_data: `wadv:hist:pg:${pg - 1}` });
        if ((pg + 1) * HISTORY_PER_PAGE < total) nav.push({ text: '▶️', callback_data: `wadv:hist:pg:${pg + 1}` });
        if (nav.length) kb.push(nav);
        kb.push(
            [{ text: '📣 Nova campanha', callback_data: 'wadv:campaigns' }],
            [{ text: '🔙 Painel', callback_data: 'wadv:home' }]
        );

        return {
            message:
                `📋 <b>Histórico de campanhas</b>\n\n` +
                `<b>Total:</b> ${total} registro${total !== 1 ? 's' : ''}\n\n` +
                lines,
            keyboard: { inline_keyboard: kb },
        };
    }

    async buildScheduledPanel(telegramId) {
        const pending = await listPendingCampaigns(telegramId);
        const histScheduled = getHistory(telegramId).filter((r) => r.status === 'scheduled');

        const merged = new Map();
        for (const r of histScheduled) {
            if (r.jobId) merged.set(r.jobId, { ...r, source: 'history' });
        }
        for (const j of pending) {
            merged.set(j.jobId, { ...j, source: 'queue', status: 'scheduled' });
        }

        const items = [...merged.values()].sort(
            (a, b) => new Date(a.runAt || a.at) - new Date(b.runAt || b.at)
        );

        const lines =
            items.length > 0
                ? items
                      .slice(0, 8)
                      .map((r) => {
                          const when = r.runAt || r.at;
                          const whenStr = when
                              ? new Date(when).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
                              : '—';
                          return `⏰ <b>${whenStr}</b>\n   ${this._modeLabel(r.mode)} · ${r.groups || '?'} grupos`;
                      })
                      .join('\n\n')
                : '<i>Nenhuma campanha agendada.</i>';

        const kb = [];
        for (const r of items.slice(0, 4)) {
            if (r.jobId) {
                kb.push([
                    {
                        text: `🚫 Cancelar ${new Date(r.runAt || r.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`,
                        callback_data: `wadv:sched:cancel:${r.jobId}`,
                    },
                ]);
            }
        }
        kb.push(
            [{ text: '🔄 Atualizar', callback_data: 'wadv:scheduled' }],
            [{ text: '📣 Nova campanha', callback_data: 'wadv:campaigns' }],
            [{ text: '🔙 Painel', callback_data: 'wadv:home' }]
        );

        return {
            message:
                `⏰ <b>Campanhas agendadas</b>\n\n` +
                `<b>Pendentes:</b> ${items.length}\n\n` +
                lines,
            keyboard: { inline_keyboard: kb },
        };
    }

    async cancelScheduledCampaign(telegramId, jobId) {
        const removed = await cancelCampaignJob(jobId);
        updateHistoryEntry(telegramId, jobId, { status: 'cancelled', cancelledAt: new Date().toISOString() });
        return {
            ok: true,
            message: removed
                ? '✅ <b>Agendamento cancelado.</b>'
                : 'ℹ️ Agendamento removido do histórico (job já executado ou indisponível).',
            panel: await this.buildScheduledPanel(telegramId),
        };
    }

    async statsPanel(telegramId) {
        const guard = await this._guardWorker(telegramId);
        if (!guard.ok) return guard;

        const { client, state } = guard;
        const uid = Number(telegramId);
        const listed = await client.sendCommand('wa.list_groups', { limit: 100 }, uid);
        const parsed = this._parseGroupsFromIpc(listed);
        const groups = parsed.ok ? parsed.groups : [];
        const phone = state?.phone ? `<code>${state.phone}</code>` : '—';
        const conn = state?.connected ? '🟢 Conectado' : '🔴 Desconectado';
        const hist = historyTotals(telegramId);

        const recent = hist.rows
            .filter((r) => r.status === 'done' || r.status === 'scheduled' || r.status === 'running')
            .slice(0, 5)
            .map((r) => {
                const when = r.at ? new Date(r.at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—';
                const icon = r.status === 'done' ? '✅' : r.status === 'scheduled' ? '⏰' : '🔄';
                const detail =
                    r.status === 'done'
                        ? `${r.sent || 0}/${r.total || r.groups || '?'} env.`
                        : `${r.groups || '?'} grupos`;
                return `${icon} ${when} · ${this._modeLabel(r.mode)} · ${detail}`;
            })
            .join('\n');

        return {
            message:
                `📊 <b>Estatísticas Hanork Div</b>\n\n` +
                `📱 <b>WhatsApp:</b> ${conn}\n` +
                `📞 <b>Número:</b> ${phone}\n` +
                `👥 <b>Grupos sincronizados:</b> ${groups.length}\n\n` +
                `📣 <b>Campanhas:</b> ${hist.campaigns}\n` +
                `📤 <b>Total enviados:</b> ${hist.sent}\n` +
                (hist.failed ? `❌ <b>Falhas:</b> ${hist.failed}\n` : '') +
                (recent ? `\n<b>Recentes:</b>\n${recent}` : '\n<i>Nenhuma campanha registrada ainda.</i>'),
        };
    }

    async listGroupsPanel(telegramId) {
        const guard = await this._guardWorker(telegramId);
        if (!guard.ok) return guard;

        const { client } = guard;
        const uid = Number(telegramId);
        await client.sendCommand('wa.sync_groups', {}, uid).catch((e) => {
            logger.warn('[WaDivulgacao] sync_groups failed', { telegramId, error: e?.message });
        });
        const listed = await client.sendCommand('wa.list_groups', { limit: 25 }, uid);
        const parsed = this._parseGroupsFromIpc(listed);
        if (!parsed.ok) return { ok: false, message: parsed.message };
        const groups = parsed.groups;
        if (!groups.length) {
            return { message: '👥 Nenhum grupo sincronizado ainda.\n\nParticipe de grupos no WhatsApp e toque em sincronizar.' };
        }
        const lines = groups
            .slice(0, 20)
            .map((g, i) => `${i + 1}. <b>${String(g.subject || g.shortId || 'Grupo').slice(0, 40)}</b>`);
        return {
            message:
                `👥 <b>Seus grupos</b> (${groups.length})\n\n` +
                `${lines.join('\n')}\n\n` +
                `<i>Use <b>📣 Campanhas</b> para disparar nos grupos escolhidos.</i>`,
        };
    }
}

let singleton = null;

function getWaDivulgacaoCampaignService() {
    if (!singleton) singleton = new WaDivulgacaoCampaignService();
    return singleton;
}

module.exports = { WaDivulgacaoCampaignService, getWaDivulgacaoCampaignService };
