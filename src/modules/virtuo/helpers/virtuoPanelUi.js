'use strict';

const { Markup } = require('telegraf');
const { getScreenPhotoInput } = require('../../../telegram/screenPhoto');
const { resolvePhotoInput, isLocalFilePhotoInput } = require('../../../telegram/messageDelivery');
const { resetPanelUserMsgCounter } = require('../../../telegram/panelDistance');

const VIRTUO_PANEL_OPTS = { parse_mode: 'HTML', useMenuPhoto: true, screen: 'virtuo' };

async function virtuoPanel(ctx, Msg, text, markup = null, panelCtx = {}) {
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
    const photo = resolvePhotoInput(getScreenPhotoInput('virtuo', uid) || getScreenPhotoInput('smm', uid));
    const opts = {
        ...VIRTUO_PANEL_OPTS,
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

    try {
        return await Msg.editCallbackPanel(ctx, text, kb, opts);
    } catch {
        return Msg.reply(ctx, text, kb, opts);
    }
}

module.exports = { virtuoPanel, VIRTUO_PANEL_OPTS };
