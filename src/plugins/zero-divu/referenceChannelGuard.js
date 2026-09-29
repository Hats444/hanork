'use strict';

const { Markup } = require('telegraf');
const { connect } = require('../config/database-sqlite');
const {
    getSalesRefChannelId,
    getSalesRefChannelUrl,
    isRefChannelRequired,
    isSalesRefChannel,
    isRefChannelAutoVerifyEnabled,
    isRefChannelManualVerifyEnabled,
    CHANNEL_UI,
} = require('../config/salesReferenceChannel');

const MEMBER_STATUSES = new Set(['creator', 'administrator', 'member', 'restricted']);
const CACHE_TTL_MS = Math.max(30_000, Number(process.env.REF_CHANNEL_CACHE_MS) || 90_000);
const PENDING_KV_PREFIX = 'ref_pending:';
const PENDING_TTL_MS = 30 * 60 * 1000;

let _bot = null;
let _isAdmin = null;
const _cache = new Map();

function configure({ bot, isAdmin } = {}) {
    if (bot) _bot = bot;
    if (typeof isAdmin === 'function') _isAdmin = isAdmin;
}

function clearMemberCache(uid) {
    if (uid != null) _cache.delete(String(uid));
}

function cacheGet(uid) {
    const hit = _cache.get(String(uid));
    if (!hit) return null;
    if (Date.now() - hit.at > CACHE_TTL_MS) {
        _cache.delete(String(uid));
        return null;
    }
    return hit.member;
}

function cacheSet(uid, member) {
    _cache.set(String(uid), { member: !!member, at: Date.now() });
}

function isEnabled() {
    return isRefChannelRequired() && !!getSalesRefChannelId();
}

function bypassUid(uid) {
    return uid != null && _isAdmin?.(uid);
}

function pendingKey(uid) {
    return `${PENDING_KV_PREFIX}${uid}`;
}

function savePendingAction(uid, action) {
    if (!uid || !action) return;
    try {
        const db = connect();
        db.prepare(
            `INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, datetime('now'))`
        ).run(pendingKey(uid), JSON.stringify({ ...action, at: Date.now() }));
    } catch (e) {
        const logger = require('../config/logger');
        logger.warn('[refChannel] savePending:', e.message);
    }
}

function loadPending(uid) {
    if (!uid) return null;
    try {
        const row = connect().prepare('SELECT value FROM kv_store WHERE key=?').get(pendingKey(uid));
        if (!row?.value) return null;
        const p = JSON.parse(row.value);
        if (Date.now() - (p.at || 0) > PENDING_TTL_MS) {
            clearPending(uid);
            return null;
        }
        return p;
    } catch {
        return null;
    }
}

function clearPending(uid) {
    if (!uid) return;
    try {
        connect().prepare('DELETE FROM kv_store WHERE key=?').run(pendingKey(uid));
    } catch {
        /* ignore */
    }
}

function loadAndClearPending(uid) {
    const p = loadPending(uid);
    if (p) clearPending(uid);
    return p;
}

function mapStartPayloadToPending(payload) {
    const raw = String(payload || '').trim();
    if (!raw || raw.startsWith('ref_')) return null;
    const p = raw.toLowerCase();

    if (p === 'downloads' || p === 'download') return { type: 'callback', data: 'downloads:open' };
    if (p === 'smm' || p === 'servicos') return { type: 'callback', data: 'smm:home' };
    if (p === 'handiv' || p === 'hanorkdiv' || p === 'wadv' || p === 'wadiv' || p === 'zap' || p === 'divulgacao' || p === 'div') {
        return { type: 'callback', data: 'wadv:plans' };
    }

    if (p.startsWith('buy_')) {
        const pid = parseInt(p.replace(/^buy_/, ''), 10);
        if (!isNaN(pid)) return { type: 'callback', data: `buy_${pid}` };
    }
    if (p.startsWith('produto_')) {
        const pid = parseInt(p.replace('produto_', ''), 10);
        if (!isNaN(pid)) return { type: 'callback', data: `p_${pid}` };
    }

    try {
        const { isShopAreaStartPayload } = require('./botInviteCopy');
        if (isShopAreaStartPayload(raw)) return { type: 'callback', data: 'catalog:view' };
    } catch {
        /* ignore */
    }

    return { type: 'start', payload: raw };
}

function capturePendingFromStartPayload(payload) {
    return mapStartPayloadToPending(payload);
}

function capturePendingFromCtx(ctx) {
    const data = ctx.callbackQuery?.data;
    if (data && data !== 'ref:verify' && data !== 'menu:home' && data !== 'home') {
        return { type: 'callback', data };
    }

    const text = String(ctx.message?.text || '').trim();
    const startMatch = text.match(/^\/start(?:@\w+)?\s+(.+)$/i);
    if (startMatch) {
        const mapped = mapStartPayloadToPending(startMatch[1].trim());
        if (mapped) return mapped;
    }

    if (/^\/downloads?\b/i.test(text)) return { type: 'callback', data: 'downloads:open' };
    if (/^\/cat(?:alog)?\b/i.test(text)) return { type: 'callback', data: 'catalog:view' };

    if (text.startsWith('/')) {
        const cmd = text.split(/\s+/)[0].toLowerCase().replace(/@\w+$/, '');
        if (cmd !== '/start') return { type: 'command', text: cmd };
    }

    return null;
}

function isExemptAction(ctx) {
    const uid = ctx.from?.id;
    if (bypassUid(uid)) return true;

    if (ctx.callbackQuery?.data === 'ref:verify') return true;

    const data = String(ctx.callbackQuery?.data || '');
    if (data.startsWith('onb_')) return true;

    const text = String(ctx.message?.text || '').trim();
    // /start passa ao handler (upsert + gate unificado); todo o resto exige canal
    if (/^\/start(?:@\w+)?/i.test(text)) return true;

    return false;
}

async function fetchMembership(uid, { forceRefresh = false } = {}) {
    if (!uid || !isEnabled()) return true;
    if (bypassUid(uid)) return true;

    if (!forceRefresh) {
        const cached = cacheGet(uid);
        if (cached != null) return cached;
    }

    const channelId = getSalesRefChannelId();
    const telegram = _bot?.telegram;
    if (!telegram || !channelId) return true;

    try {
        const member = await telegram.getChatMember(channelId, uid);
        const ok = MEMBER_STATUSES.has(String(member?.status || ''));
        cacheSet(uid, ok);
        return ok;
    } catch {
        const cached = cacheGet(uid);
        if (cached != null) return cached;
        return false;
    }
}

function buildGateText() {
    const auto = isRefChannelAutoVerifyEnabled();
    const manual = isRefChannelManualVerifyEnabled();
    let steps = `• Toque em <b>${CHANNEL_UI.button}</b> e entre no canal\n`;
    if (auto && manual) {
        steps +=
            `• A liberação é <b>automática</b> ao entrar — ou toque em <b>${CHANNEL_UI.verify}</b> se preferir\n`;
    } else if (auto) {
        steps += `• Ao entrar, a liberação é <b>automática</b> — volte aqui em instantes\n`;
    } else {
        steps += `• Volte aqui e toque em <b>${CHANNEL_UI.verify}</b>\n`;
    }
    return (
        `<b>${CHANNEL_UI.title}</b>\n\n` +
        `Inscreva-se no canal para usar a <b>Hanork</b> — loja, downloads e conta.\n\n` +
        steps
    );
}

function buildGateKeyboard() {
    const url = getSalesRefChannelUrl();
    const { MENU_BTN } = require('./menus/menuCopy');
    const rows = [];
    if (url) rows.push([Markup.button.url(CHANNEL_UI.button, url)]);
    if (isRefChannelManualVerifyEnabled()) {
        rows.push([Markup.button.callback(CHANNEL_UI.verify, 'ref:verify')]);
    }
    rows.push([Markup.button.callback(MENU_BTN.menu, 'menu:home')]);
    return Markup.inlineKeyboard(rows);
}

async function showGatePanel(ctx) {
    const Msg = require('./Msg');
    const text = buildGateText();
    const kb = buildGateKeyboard();

    try {
        if (ctx.callbackQuery) {
            await ctx.answerCbQuery('Inscreva-se no canal primeiro').catch(() => {});
            await Msg.editCallbackPanel(ctx, text, kb, { useMenuPhoto: true });
            return;
        }
        await Msg.replaceMenu(ctx, text, kb, { useMenuPhoto: true });
    } catch (e) {
        const logger = require('../config/logger');
        logger.warn('[refChannel] showGatePanel:', e.message);
    }
}

async function blockWithGate(ctx) {
    const pending = capturePendingFromCtx(ctx);
    if (pending) savePendingAction(ctx.from?.id, pending);
    await showGatePanel(ctx);
}

async function isMember(ctx, opts = {}) {
    const uid = ctx.from?.id;
    return fetchMembership(uid, opts);
}

async function enforce(ctx) {
    if (!isEnabled()) return true;
    if (isExemptAction(ctx)) return true;
    if (await isMember(ctx)) return true;
    await blockWithGate(ctx);
    return false;
}

function mapPendingToStartPayload(pending) {
    if (!pending) return null;
    if (pending.type === 'callback' && pending.data) {
        const d = String(pending.data);
        const buy = d.match(/^buy_(\d+)$/);
        const prod = d.match(/^p_(\d+)$/);
        if (buy) return `buy_${buy[1]}`;
        if (prod) return `produto_${prod[1]}`;
        if (d === 'downloads:open') return 'downloads';
        if (d.startsWith('smm:')) return 'smm';
        if (d.startsWith('wadv:')) return 'handiv';
        if (d === 'catalog:view' || d === 'cat' || /^cat_/.test(d)) return 'comprar';
    }
    if (pending.type === 'start' && pending.payload) return String(pending.payload);
    return null;
}

async function interceptIfNeeded(ctx, bot, isAdminFn) {
    if (bot && !_bot) _bot = bot;
    if (isAdminFn && !_isAdmin) _isAdmin = isAdminFn;
    if (!isEnabled()) return false;
    if (isExemptAction(ctx)) return false;
    if (await isMember(ctx)) return false;

    const groupGuard = require('./groupGuard');
    if (groupGuard.isGroupChat(ctx)) {
        const pending = capturePendingFromCtx(ctx);
        if (pending) savePendingAction(ctx.from?.id, pending);
        await groupGuard.replyGroupRedirect(ctx, bot, {
            startPayload: mapPendingToStartPayload(pending),
            title: `📢 ${CHANNEL_UI.title}`,
            buttonText: '📢 Canal + abrir no privado',
            body:
                'Inscreva-se no <b>canal de referências</b> para usar loja, downloads e conta.\n\n' +
                'Toque no botão → entre no canal → abra o bot no privado.',
            showAlert: true,
        });
        return true;
    }

    await blockWithGate(ctx);
    return true;
}

async function resumeLegacyCallback(ctx, data) {
    const s = String(data || '');

    if (/^buy_\d+$/.test(s)) {
        const { requireBotContext } = require('./callbacks/BotContext');
        const { startBuyProduct } = requireBotContext(['startBuyProduct']);
        const pid = parseInt(s.replace('buy_', ''), 10);
        await startBuyProduct(ctx, pid);
        return true;
    }

    if (s === 'cat_hub' || /^cat_/.test(s)) {
        const catalogBrowse = require('../utils/catalogBrowse');
        const { requireBotContext } = require('./callbacks/BotContext');
        const { openUserCatalog } = requireBotContext(['openUserCatalog']);
        const mode = catalogBrowse.parseCatCallback?.(s) || { mode: 'hub' };
        await openUserCatalog(ctx, mode);
        return true;
    }

    if (s.startsWith('smm:')) {
        const { sendPlatforms } = require('../modules/smm/handlers/smmUiHandlers');
        const Msg = require('./Msg');
        await sendPlatforms(ctx, Msg);
        return true;
    }

    if (s.startsWith('wadv:')) {
        const { sendWaDivulgacaoPlans, isWaDivulgacaoEnabled } = require('../modules/wa-divulgacao/handlers/waDivulgacaoUiHandlers');
        if (isWaDivulgacaoEnabled()) {
            await sendWaDivulgacaoPlans(ctx);
            return true;
        }
    }

    return false;
}

async function resumeCallback(ctx, data) {
    if (!data) return false;

    if (!ctx.callbackQuery) {
        ctx._refChannelSynthetic = true;
        if (typeof ctx.answerCbQuery !== 'function') {
            ctx.answerCbQuery = async () => {};
        }
        ctx.callbackQuery = {
            id: `ref_resume_${Date.now()}`,
            from: ctx.from,
            chat_instance: String(ctx.chat?.id || ''),
        };
    }

    const prevData = ctx.callbackQuery.data;
    ctx.callbackQuery.data = data;

    try {
        const { normalizeCallbackData } = require('./callbacks/legacyPatterns');
        const norm = normalizeCallbackData(data);
        if (norm) ctx.callbackQuery.data = norm;

        const { registry } = require('../core/CallbackRegistry');
        if (await registry.dispatch(ctx)) return true;
        if (await resumeLegacyCallback(ctx, ctx.callbackQuery.data)) return true;
    } catch (e) {
        const logger = require('../config/logger');
        logger.warn('[refChannel] resumeCallback:', e.message);
    } finally {
        ctx.callbackQuery.data = prevData;
    }

    return false;
}

async function resumePendingAction(ctx) {
    const pending = loadAndClearPending(ctx.from?.id);
    if (!pending) return false;

    if (pending.type === 'callback' && pending.data) {
        return resumeCallback(ctx, pending.data);
    }

    if (pending.type === 'command' && pending.text) {
        const cmdMap = {
            '/downloads': 'downloads:open',
            '/download': 'downloads:open',
            '/cat': 'catalog:view',
            '/catalog': 'catalog:view',
        };
        const cb = cmdMap[pending.text];
        if (cb) return resumeCallback(ctx, cb);
    }

    if (pending.type === 'start' && pending.payload) {
        const mapped = mapStartPayloadToPending(pending.payload);
        if (mapped?.type === 'callback' && mapped.data) {
            return resumeCallback(ctx, mapped.data);
        }
    }

    return false;
}

async function verifyAndRefresh(ctx, bot) {
    if (bot?.telegram) _bot = bot;
    else if (ctx?.telegram) _bot = { telegram: ctx.telegram };
    const uid = ctx.from?.id;
    clearMemberCache(uid);
    return fetchMembership(uid, { forceRefresh: true });
}

function isUserJoinedRefChannel(update) {
    if (!update?.chat || update.chat.type !== 'channel') return false;
    if (!isSalesRefChannel(update.chat.id)) return false;
    const u = update.new_chat_member?.user;
    if (!u || u.is_bot) return false;
    const oldSt = update.old_chat_member?.status;
    const newSt = update.new_chat_member?.status;
    const wasOut = !oldSt || oldSt === 'left' || oldSt === 'kicked';
    return wasOut && MEMBER_STATUSES.has(String(newSt || ''));
}

function buildPrivateResumeCtx(bot, user, telegram) {
    const uid = user?.id;
    const tg = telegram || bot?.telegram || _bot?.telegram;
    const noopAsync = async () => {};
    return {
        from: user,
        chat: { id: uid, type: 'private' },
        telegram: tg,
        bot: bot || _bot,
        _refChannelSynthetic: true,
        answerCbQuery: noopAsync,
        reply: (...args) => tg?.sendMessage(uid, ...args),
    };
}

async function completeVerification(ctx, opts = {}) {
    const source = opts.source || 'manual';
    const uid = ctx.from?.id;
    if (!uid) return { ok: false, reason: 'no_user' };

    if (opts.bot?.telegram) _bot = opts.bot;
    else if (ctx.bot?.telegram) _bot = ctx.bot;
    else if (ctx.telegram && !_bot) _bot = { telegram: ctx.telegram };

    clearMemberCache(uid);
    const member = await fetchMembership(uid, { forceRefresh: true });
    if (!member) return { ok: false, reason: 'not_member', source };

    const resumed = await resumePendingAction(ctx);
    return { ok: true, resumed, source };
}

async function handleRefChannelChatMember(ctx) {
    if (!isEnabled() || !isRefChannelAutoVerifyEnabled()) return false;

    const update = ctx.chatMember;
    if (!isUserJoinedRefChannel(update)) return false;

    const u = update.new_chat_member.user;
    const uid = u.id;
    const telegram = _bot?.telegram || ctx.telegram || ctx.bot?.telegram;
    if (!telegram) return true;

    const logger = require('../config/logger');
    const hadPending = !!loadPending(uid);
    logger.info('[refChannel] auto-verify join', { uid, hadPending });

    cacheSet(uid, true);

    const resumeCtx = buildPrivateResumeCtx(ctx.bot || _bot, u, telegram);
    const { ok, resumed } = await completeVerification(resumeCtx, { source: 'auto', bot: ctx.bot });

    if (!ok) return true;

    if (!resumed && hadPending) {
        try {
            await telegram.sendMessage(
                uid,
                '✅ <b>Canal confirmado!</b>\n\nVolte ao bot e use /start para continuar.',
                { parse_mode: 'HTML' }
            );
        } catch (e) {
            logger.debug('[refChannel] auto-verify pending fallback:', e.message);
        }
        return true;
    }

    if (!resumed && !hadPending) {
        try {
            const me = await telegram.getMe();
            await telegram.sendMessage(
                uid,
                '✅ <b>Canal de referências confirmado!</b>\n\n' +
                    'Volte ao bot para usar catálogo, downloads e conta.',
                {
                    parse_mode: 'HTML',
                    reply_markup: Markup.inlineKeyboard([
                        [Markup.button.url('🏠 Abrir Hanork', `https://t.me/${me.username}`)],
                    ]).reply_markup,
                }
            );
        } catch (e) {
            logger.debug('[refChannel] auto-verify PV:', e.message);
        }
    }

    return true;
}

function channelMenuRow({ legacy = false } = {}) {
    const url = getSalesRefChannelUrl();
    if (!url) return null;
    const label = legacy ? CHANNEL_UI.menuLegacy : CHANNEL_UI.menu;
    return [{ text: label, url }];
}

function buildMenuChannelNotice(isMemberUser) {
    if (!isEnabled() || isMemberUser) return '';
    return `\n\n<b>${CHANNEL_UI.title}</b> — inscreva-se para liberar o catálogo.`;
}

module.exports = {
    configure,
    isEnabled,
    isExemptAction,
    isMember,
    enforce,
    interceptIfNeeded,
    verifyAndRefresh,
    completeVerification,
    handleRefChannelChatMember,
    isRefChannelManualVerifyEnabled,
    clearMemberCache,
    savePendingAction,
    capturePendingFromStartPayload,
    capturePendingFromCtx,
    showGatePanel,
    blockWithGate,
    resumePendingAction,
    buildGateText,
    buildGateKeyboard,
    mapPendingToStartPayload,
    channelMenuRow,
    buildMenuChannelNotice,
    getSalesRefChannelUrl,
};
