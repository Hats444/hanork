'use strict';

const { Markup } = require('telegraf');
const { getScreenPhotoInput } = require('../../../telegram/screenPhoto');
const { getMenuPhotoInput } = require('../../../telegram/menuPhoto');
const { truncateTelegramHtml, CAPTION_MAX } = require('../../../telegram/telegramLimits');
const {
    resolvePhotoInput,
    isLocalFilePhotoInput,
    pickTelegramOpts,
    unwrapReplyMarkup,
} = require('../../../telegram/messageDelivery');
const { resetPanelUserMsgCounter } = require('../../../telegram/panelDistance');
const logger = require('../../../config/logger');

const PANEL_OPTS = { parse_mode: 'HTML', useMenuPhoto: true, screen: 'wa_divulgacao' };
const PANEL_CAPTION_MAX = CAPTION_MAX - 16;

function resolveWaDivChatId(ctx, fallbackId = null) {
    return (
        ctx?.chat?.id ??
        ctx?.callbackQuery?.message?.chat?.id ??
        fallbackId ??
        ctx?.from?.id ??
        null
    );
}

function resolveWaDivPhoto(userId) {
    return (
        resolvePhotoInput(getScreenPhotoInput('wa_divulgacao', userId)) ||
        resolvePhotoInput(getScreenPhotoInput('telegram', userId)) ||
        resolvePhotoInput(getMenuPhotoInput(userId, 'wadv-panel', null, { rotate: false }))
    );
}

function panelCaption(text) {
    return truncateTelegramHtml(String(text || ''), PANEL_CAPTION_MAX);
}

function buildPanelOpts(userId, panelCtx = {}) {
    const photo = resolveWaDivPhoto(userId);
    return {
        ...PANEL_OPTS,
        forceMenuPhoto: true,
        skipLongSplit: true,
        ...panelCtx,
        ...(photo
            ? {
                  photo,
                  reuseMedia: false,
                  photoChanged: true,
                  forceNew: !isLocalFilePhotoInput(photo),
              }
            : {}),
    };
}

/** Mensagem nova (entrega pós-pagamento, notificações WA) — foto de menu + teclado. */
async function pushWaDivulgacaoPanel(telegram, chatId, userId, text, markup = null) {
    if (!telegram || !chatId) return null;
    const kb =
        markup == null
            ? null
            : markup.reply_markup || markup.inline_keyboard
              ? markup
              : Markup.inlineKeyboard(markup.inline_keyboard || markup);
    const photo = resolveWaDivPhoto(userId || chatId);
    const caption = panelCaption(text);
    const opts = pickTelegramOpts({
        parse_mode: 'HTML',
        ...(kb ? { reply_markup: unwrapReplyMarkup(kb) } : {}),
    });
    try {
        if (photo) {
            const input = resolvePhotoInput(photo) || photo;
            return await telegram.sendPhoto(chatId, input, { caption, ...opts });
        }
        return await telegram.sendMessage(chatId, caption, opts);
    } catch (e) {
        logger.warn('[WaDivulgacao] push panel photo failed', { chatId, error: e?.message });
        return telegram.sendMessage(chatId, caption, opts).catch((e2) => {
            logger.warn('[WaDivulgacao] push panel text failed', { chatId, error: e2?.message });
            return null;
        });
    }
}

async function waDivulgacaoPanel(ctx, Msg, text, markup = null, panelCtx = {}) {
    const kb =
        markup == null
            ? null
            : markup.reply_markup || markup.inline_keyboard
              ? markup
              : Markup.inlineKeyboard(markup.inline_keyboard || markup);

    const chatId = ctx.chat?.id || ctx.callbackQuery?.message?.chat?.id;
    if (Msg?.lastMenuMsg && chatId) {
        await resetPanelUserMsgCounter(Msg.lastMenuMsg, chatId).catch(() => {});
    }

    const uid = ctx.from?.id || chatId;
    const opts = buildPanelOpts(uid, panelCtx);
    const caption = panelCaption(text);

    try {
        return await Msg.editCallbackPanel(ctx, caption, kb, opts);
    } catch {
        return Msg.reply(ctx, caption, kb, opts);
    }
}

module.exports = {
    waDivulgacaoPanel,
    pushWaDivulgacaoPanel,
    resolveWaDivChatId,
    resolveWaDivPhoto,
    panelCaption,
    PANEL_OPTS,
};
