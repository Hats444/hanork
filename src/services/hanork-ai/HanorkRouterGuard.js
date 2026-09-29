'use strict';

const { ACTIONS } = require('../../config/hanork-ai-actions');
const groupGuard = require('../../telegram/groupGuard');

/** Ações permitidas a membros via Hanork em grupo (sem dados sensíveis / checkout) */
const GROUP_MEMBER_SAFE = new Set([
    ACTIONS.PLAY_MUSIC,
    ACTIONS.DOWNLOAD,
    ACTIONS.SHOW_PRODUCTS,
    ACTIONS.RECOMMEND_PRODUCT,
    ACTIONS.PRODUCT_SEARCH,
    ACTIONS.PIX,
    ACTIONS.SUBSCRIPTION,
    ACTIONS.FLASH_SALES,
    ACTIONS.GIVEAWAY,
    ACTIONS.HELP,
    ACTIONS.SUPPORT,
    ACTIONS.ASK,
    ACTIONS.NONE,
    ACTIONS.RUN_SLASH,
]);

/** Comandos / que membros podem disparar via Hanork em grupos */
const GROUP_SAFE_SLASH = new Set([
    'buscar',
    'smm_buscar',
    'smm',
    'servicos',
    'cat',
    'catalogo',
    'help',
    'comandos',
    'play',
    'youtube',
    'tiktok',
    'instagram',
    'ig',
    'downloads',
    'download',
    'start',
    'id',
    'hanork',
]);

const ADMIN_ONLY_ACTIONS = new Set([
    ACTIONS.ADMIN,
    ACTIONS.ADMIN_STATS,
    ACTIONS.ADMIN_ORDERS,
    ACTIONS.ADMIN_PRODUCTS,
    ACTIONS.ADMIN_GROUPS,
    ACTIONS.ADMIN_CHANNELS,
    ACTIONS.ADMIN_TICKETS,
    ACTIONS.ADMIN_FINANCE,
    ACTIONS.ADMIN_REPORT,
    ACTIONS.ADMIN_USERS,
    ACTIONS.WHATSAPP,
    ACTIONS.BROADCAST,
    ACTIONS.BROADCAST_GROUPS_PREPARE,
    ACTIONS.BROADCAST_GROUPS_RUN,
    ACTIONS.BROADCAST_CHANNELS_RUN,
    ACTIONS.BROADCAST_FULL_RUN,
    ACTIONS.BROADCAST_IA_PREPARE,
    ACTIONS.BROADCAST_TEXT_PREPARE,
    ACTIONS.BROADCAST_PRODUCT_PICK,
    ACTIONS.PRODUCT_EDIT_PRICE,
    ACTIONS.PRODUCT_EDIT_FIELD,
    ACTIONS.PRODUCT_PAUSE,
    ACTIONS.PRODUCT_REACTIVATE,
    ACTIONS.RUN_CALLBACK,
]);

/** Dados pessoais / pagamento — só no privado com o bot */
const PRIVATE_ONLY_MEMBER = new Set([
    ACTIONS.CART,
    ACTIONS.CHECKOUT,
    ACTIONS.COUPON,
    ACTIONS.AFFILIATE,
    ACTIONS.ACCOUNT,
    ACTIONS.TRACK_ORDER,
    ACTIONS.FAVORITES,
]);

function slashHead(params = {}) {
    return String(params.slash || '')
        .replace(/^\//, '')
        .split(/\s+/)[0]
        .toLowerCase();
}

function isGroupSafeSlash(params = {}) {
    return GROUP_SAFE_SLASH.has(slashHead(params));
}

function getChatId(ctx) {
    return ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id ?? null;
}

function resolveSupportGroupId(resolveFn) {
    if (typeof resolveFn === 'function') {
        try {
            return resolveFn();
        } catch {
            return null;
        }
    }
    return null;
}

function isSupportGroupChat(ctx, resolveFn) {
    const gid = resolveSupportGroupId(resolveFn);
    const chatId = getChatId(ctx);
    if (gid == null || chatId == null) return false;
    return String(chatId) === String(gid);
}

/**
 * Hanork responde no PV e em qualquer grupo/supergrupo.
 */
function isHanorkAllowedChat(ctx, _resolveFn) {
    if (groupGuard.isPrivateChat(ctx)) return true;
    return groupGuard.isGroupChat(ctx);
}

function getRouterContext(ctx, { resolveSupportGroupId: resolveFn } = {}) {
    const inPrivate = groupGuard.isPrivateChat(ctx);
    const inGroup = groupGuard.isGroupChat(ctx);
    const inSupportGroup = inGroup && isSupportGroupChat(ctx, resolveFn);

    return {
        inPrivate,
        inGroup,
        inSupportGroup,
        inMemberRouter: inPrivate || inGroup,
        chatId: getChatId(ctx),
    };
}

/**
 * @returns {{ allowed: boolean, reason?: string, redirectPrivate?: boolean }}
 */
function validateAction(action, { inPrivate, isAdmin = false, params = {} } = {}) {
    if (!action || action === ACTIONS.NONE || action === ACTIONS.ASK) {
        return { allowed: true };
    }

    if (action === ACTIONS.RUN_SLASH) {
        if (inPrivate) return { allowed: true };
        if (isGroupSafeSlash(params)) return { allowed: true };
        if (isAdmin) {
            return { allowed: false, reason: 'admin_group', redirectPrivate: true };
        }
        return { allowed: false, reason: 'group_unsafe', redirectPrivate: true };
    }

    if (ADMIN_ONLY_ACTIONS.has(action)) {
        if (inPrivate && isAdmin) return { allowed: true };
        return {
            allowed: false,
            reason: 'admin_group',
            redirectPrivate: true,
        };
    }

    if (!inPrivate && PRIVATE_ONLY_MEMBER.has(action)) {
        return {
            allowed: false,
            reason: 'private_only',
            redirectPrivate: true,
        };
    }

    if (!inPrivate && !GROUP_MEMBER_SAFE.has(action)) {
        return {
            allowed: false,
            reason: 'group_unsafe',
            redirectPrivate: true,
        };
    }

    return { allowed: true };
}

module.exports = {
    GROUP_MEMBER_SAFE,
    GROUP_SAFE_SLASH,
    PRIVATE_ONLY_MEMBER,
    ADMIN_ONLY_ACTIONS,
    isGroupSafeSlash,
    isHanorkAllowedChat,
    isSupportGroupChat,
    getRouterContext,
    validateAction,
};
