'use strict';

const { isPrivateChat, shouldForceNewMessage } = require('./freshUi');

const IDLE_MS = Number(process.env.HANORK_PANEL_IDLE_MS) || 10 * 60 * 1000;
const MSG_THRESHOLD = Number(process.env.HANORK_PANEL_MSG_THRESHOLD) || 3;

function normalizeChatId(chatId) {
    return chatId != null ? String(chatId) : null;
}

async function getPanelSlot(lastMenuMsg, chatId) {
    if (!lastMenuMsg || !chatId) return null;
    const key = normalizeChatId(chatId);
    try {
        const raw = await lastMenuMsg.get(key);
        if (!raw) return null;
        return {
            messageId: raw.messageId,
            updatedAt: raw.updatedAt || 0,
            userMsgsSince: raw.userMsgsSince || 0,
        };
    } catch {
        return null;
    }
}

/**
 * Painel distante — criar nova mensagem em vez de editar slot antigo.
 */
async function shouldCreateFreshPanel(ctx, lastMenuMsg, options = {}) {
    if (options.forceNew === true) return true;
    if (options.replaceInPlace === true) return false;
    if (!isPrivateChat(ctx)) return false;
    if (shouldForceNewMessage(ctx, options)) return true;

    const chatId = ctx.chat?.id || ctx.callbackQuery?.message?.chat?.id;
    const slot = await getPanelSlot(lastMenuMsg, chatId);
    if (!slot) return false;

    if (slot.userMsgsSince > MSG_THRESHOLD) return true;
    if (slot.updatedAt && Date.now() - slot.updatedAt > IDLE_MS) return true;

    return false;
}

/** Incrementa contador quando usuário manda texto no PV (middleware). */
async function trackUserMessageSincePanel(lastMenuMsg, chatId) {
    if (!lastMenuMsg || !chatId) return;
    const key = normalizeChatId(chatId);
    try {
        const raw = (await lastMenuMsg.get(key)) || { chatId: key };
        await lastMenuMsg.set(key, {
            ...raw,
            userMsgsSince: (raw.userMsgsSince || 0) + 1,
        });
    } catch {
        /* ignore */
    }
}

/** Reseta contador ao interagir com painel (callback ou novo painel). */
async function resetPanelUserMsgCounter(lastMenuMsg, chatId) {
    if (!lastMenuMsg || !chatId) return;
    const key = normalizeChatId(chatId);
    try {
        const raw = await lastMenuMsg.get(key);
        if (!raw) return;
        await lastMenuMsg.set(key, { ...raw, userMsgsSince: 0, updatedAt: Date.now() });
    } catch {
        /* ignore */
    }
}

module.exports = {
    IDLE_MS,
    MSG_THRESHOLD,
    shouldCreateFreshPanel,
    trackUserMessageSincePanel,
    resetPanelUserMsgCounter,
    getPanelSlot,
};
