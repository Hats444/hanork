'use strict';

/**
 * Painel de status/conclusão — foto de menu (infos/), edita ou apaga+reenvia.
 */
const logger = require('../config/logger');
const { truncateTelegramHtml, isCaptionTooLongError, CAPTION_MAX } = require('./telegramLimits');
const {
    deliverMessage,
    unwrapReplyMarkup,
    pickTelegramOpts,
    tryEditMessage,
    tryEditPhotoMessage,
    telegramChatId,
    withTelegramTimeout,
} = require('./messageDelivery');
const { getMenuPhotoInput } = require('./menuPhoto');

function wrapAdminCaption(caption) {
    return truncateTelegramHtml(caption);
}

/**
 * Edita legenda+foto; se falhar (comum no WSL), apaga e manda foto de menu nova.
 */
async function deliverAdminPanel(telegram, panel, text, tgOpts, photo, opts = {}) {
    const chatId = panel?.chatId;
    const cid = telegramChatId(chatId);
    if (!chatId || !cid) return { ok: false, action: 'no_chat' };

    const body = wrapAdminCaption(text);
    const caption = truncateTelegramHtml(body, CAPTION_MAX - 16);
    const msgId = panel?.messageId;
    const tryEdit = opts.tryEdit !== false;

    if (tryEdit && msgId && photo) {
        try {
            if (panel?.isPhoto !== false) {
                const okPhoto = await tryEditPhotoMessage(telegram, cid, msgId, photo, body, tgOpts);
                if (okPhoto) return { ok: true, action: 'edited', messageId: msgId };
            }
            const okText = await tryEditMessage(telegram, cid, msgId, body, tgOpts);
            if (okText) {
                panel.isPhoto = false;
                return { ok: true, action: 'edited', messageId: msgId };
            }
        } catch (e) {
            logger.warn('[Broadcast] edit painel:', e.message);
        }
    }

    if (msgId) {
        try {
            await withTelegramTimeout(telegram.deleteMessage(cid, msgId));
        } catch {
            /* já apagada */
        }
    }

    if (photo) {
        try {
            const sent = await withTelegramTimeout(
                telegram.sendPhoto(cid, photo, { caption, ...tgOpts })
            );
            return { ok: true, action: 'sent', messageId: sent.message_id };
        } catch (photoErr) {
            if (!isCaptionTooLongError(photoErr)) {
                logger.warn('[Broadcast] sendPhoto painel:', photoErr.message);
            }
        }
    }

    try {
        const sent = await withTelegramTimeout(telegram.sendMessage(cid, body, tgOpts));
        return { ok: true, action: 'sent', messageId: sent.message_id };
    } catch (e) {
        logger.warn('[Broadcast] sendMessage painel:', e.message);
        return { ok: false, action: 'failed', error: e.message };
    }
}

/**
 * @param {object} telegram - bot.telegram
 * @param {{ chatId, messageId, isPhoto, userId }} panel - mutável (atualiza messageId após envio)
 * @param {string} text HTML
 * @param {object} keyboard Markup
 * @param {{ adminIds?, userId?, requirePhoto?, tryEdit? }} opts
 */
async function notifyBroadcastComplete(telegram, panel, text, keyboard, opts = {}) {
    const chatId = panel?.chatId;
    const userId = panel?.userId ?? opts.userId;
    const adminIds = opts.adminIds || [];
    const requirePhoto = opts.requirePhoto !== false;
    const rm = unwrapReplyMarkup(keyboard);
    const markupOpts = rm?.inline_keyboard?.length ? { reply_markup: rm } : {};
    const tgOpts = pickTelegramOpts(markupOpts);
    const photo = getMenuPhotoInput(userId);

    if (chatId) {
        try {
            const r = await deliverAdminPanel(telegram, panel, text, tgOpts, photo, {
                tryEdit: opts.tryEdit,
            });
            if (r?.messageId) {
                panel.messageId = r.messageId;
                panel.isPhoto = !!photo;
            }
            if (r?.ok) {
                logger.info(`[Broadcast] painel admin (${r.action}, foto=${!!photo})`);
                return { ok: true, via: r.action };
            }
        } catch (e) {
            logger.warn('[Broadcast] painel admin:', e.message);
        }
    }

    for (const aid of adminIds) {
        if (!aid) continue;
        try {
            const dmPhoto = getMenuPhotoInput(aid);
            const dmPanel = { chatId: aid, messageId: null, userId: aid };
            const r = await deliverAdminPanel(
                telegram,
                dmPanel,
                `✅ <b>Divulgação concluída</b>\n\n${text}`,
                tgOpts,
                dmPhoto,
                { tryEdit: false }
            );
            if (r?.ok) {
                logger.info(`[Broadcast] resumo admin ${aid} (${r.action})`);
                return { ok: true, via: 'dm' };
            }
        } catch (e) {
            logger.warn(`[Broadcast] notify admin ${aid}:`, e.message);
        }
    }

    if (chatId && photo && requirePhoto) {
        try {
            const sent = await telegram.sendPhoto(chatId, photo, {
                caption: wrapAdminCaption(text),
                ...tgOpts,
            });
            panel.messageId = sent.message_id;
            panel.isPhoto = true;
            return { ok: true, via: 'sendPhoto' };
        } catch (e) {
            logger.warn('[Broadcast] sendPhoto fallback:', e.message);
        }
    }

    return { ok: false };
}

module.exports = { notifyBroadcastComplete, wrapAdminCaption, deliverAdminPanel };
