'use strict';

const { Markup } = require('telegraf');
const logger = require('../../../config/logger');
const { resolvePhotoInput } = require('../../../telegram/messageDelivery');
const { getScreenPhotoInput } = require('../../../telegram/screenPhoto');
const dbRaw = require('../../../config/database-sqlite').connect;

const KV_PREFIX = 'virtuo_order_panel:';

function trackKey(hanorkOrderId) {
    return `${KV_PREFIX}${String(hanorkOrderId || '').trim()}`;
}

function getTrack(hanorkOrderId) {
    try {
        const row = dbRaw().prepare('SELECT value FROM kv_store WHERE key = ?').get(trackKey(hanorkOrderId));
        if (!row?.value) return null;
        return JSON.parse(row.value);
    } catch {
        return null;
    }
}

function setTrack(hanorkOrderId, data) {
    try {
        dbRaw()
            .prepare("INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, datetime('now'))")
            .run(trackKey(hanorkOrderId), JSON.stringify(data));
    } catch (e) {
        logger.warn('[Virtuo:panel] track save failed', { detail: e.message });
    }
}

function clearTrack(hanorkOrderId) {
    try {
        dbRaw().prepare('DELETE FROM kv_store WHERE key = ?').run(trackKey(hanorkOrderId));
    } catch {
        /* ignore */
    }
}

function unwrapKeyboard(keyboard) {
    if (!keyboard) return {};
    const km = keyboard.reply_markup || keyboard;
    return km?.inline_keyboard ? { reply_markup: km } : keyboard;
}

/**
 * Envia ou edita a mensagem única do pedido Virtuo (evita poluir o chat).
 */
async function upsertOrderPanel(bot, telegramId, hanorkOrderId, html, keyboard = null, screen = 'virtuo') {
    if (!bot?.telegram || !telegramId || !hanorkOrderId) return false;

    const extra = { parse_mode: 'HTML', disable_web_page_preview: true, ...unwrapKeyboard(keyboard) };
    const track = getTrack(hanorkOrderId);

    if (track?.messageId && track.chatId) {
        try {
            if (track.isPhoto) {
                await bot.telegram.editMessageCaption(
                    track.chatId,
                    track.messageId,
                    undefined,
                    html,
                    extra
                );
            } else {
                await bot.telegram.editMessageText(html, {
                    chat_id: track.chatId,
                    message_id: track.messageId,
                    ...extra,
                });
            }
            return true;
        } catch (e) {
            logger.debug('[Virtuo:panel] edit failed, replace', { detail: e.message });
            await bot.telegram.deleteMessage(track.chatId, track.messageId).catch(() => {});
        }
    }

    const photo = resolvePhotoInput(getScreenPhotoInput(screen, telegramId) || getScreenPhotoInput('wallet', telegramId));
    try {
        let msg;
        if (photo) {
            msg = await bot.telegram.sendPhoto(telegramId, photo, { caption: html, ...extra });
            setTrack(hanorkOrderId, { chatId: telegramId, messageId: msg.message_id, isPhoto: true });
        } else {
            msg = await bot.telegram.sendMessage(telegramId, html, extra);
            setTrack(hanorkOrderId, { chatId: telegramId, messageId: msg.message_id, isPhoto: false });
        }
        return true;
    } catch (e) {
        logger.warn('[Virtuo:panel] send failed', { detail: e.message });
        try {
            await bot.telegram.sendMessage(telegramId, html, extra);
            return true;
        } catch (e2) {
            logger.warn('[Virtuo:panel] fallback failed', { detail: e2.message });
            return false;
        }
    }
}

module.exports = {
    upsertOrderPanel,
    getTrack,
    clearTrack,
};
