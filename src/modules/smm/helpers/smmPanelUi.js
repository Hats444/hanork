'use strict';

const { Markup } = require('telegraf');
const { getScreenPhotoInput, getPlatformPhotoInput, screenFromPlatform, findScreenFile } = require('../../../telegram/screenPhoto');
const { resolvePhotoInput, isLocalFilePhotoInput } = require('../../../telegram/messageDelivery');
const { resetPanelUserMsgCounter } = require('../../../telegram/panelDistance');

const SMM_PANEL_OPTS = { parse_mode: 'HTML', useMenuPhoto: true };

function resolvePanelPhoto(ctx, options = {}) {
    const uid = ctx.from?.id || ctx.chat?.id;
    if (options.photo || options.photoUrl) {
        return resolvePhotoInput(options.photo || options.photoUrl);
    }
    const screen = options.screen || (options.platform ? screenFromPlatform(options.platform) : 'smm');
    if (screen) {
        const p = resolvePhotoInput(getScreenPhotoInput(screen, uid));
        if (p) return p;
    }
    if (options.platform) {
        return resolvePhotoInput(getPlatformPhotoInput(options.platform, uid));
    }
    return null;
}

function buildPanelOpts(ctx, options = {}) {
    const screen = options.screen || (options.platform ? screenFromPlatform(options.platform) : 'smm');
    const photo = resolvePanelPhoto(ctx, { ...options, screen });
    const resolved = photo ? resolvePhotoInput(photo) : null;
    const localPhoto = resolved && isLocalFilePhotoInput(resolved);
    const fromMenuFallback = !options.photo && !options.photoUrl && !findScreenFileUsed(screen);

    return {
        ...SMM_PANEL_OPTS,
        ...options,
        screen,
        ...(resolved
            ? {
                  photo: resolved,
                  useMenuPhoto: fromMenuFallback,
                  reuseMedia: false,
                  photoChanged: true,
                  forceNew: localPhoto ? false : options.forceNew,
              }
            : {}),
    };
}

function findScreenFileUsed(screen) {
    return !!findScreenFile(screen);
}

/**
 * Um painel SMM no PV — edita a mensagem do callback ou o slot rastreado (sem flood).
 * @param {object} [panelCtx] — { screen, platform } para foto contextual
 */
async function smmPanel(ctx, Msg, text, markup = null, panelCtx = {}) {
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

    const opts = buildPanelOpts(ctx, panelCtx);
    try {
        return await Msg.editCallbackPanel(ctx, text, kb, opts);
    } catch {
        return Msg.reply(ctx, text, kb, opts);
    }
}

module.exports = { smmPanel, SMM_PANEL_OPTS, buildPanelOpts, resolvePanelPhoto };
