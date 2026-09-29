'use strict';

const {
    tryEditMessage,
    tryEditPhotoMessage,
    pickTelegramOpts,
    unwrapReplyMarkup,
    resolvePhotoInput,
    isLocalFilePhotoInput,
    isIgnorableEditError,
    isMissingMessageEditError,
    slotMessageId,
} = require('../../messageDelivery');
const { truncateTelegramHtml, CAPTION_MAX } = require('../../telegramLimits');
const { resolveProductPhotoInput } = require('../../../utils/productPhoto');

/**
 * @param {{ Msg, logger, lastMenuMsg, Markup, bot, prisma, MP, comprasPendentes, cartKey, CONFIG }} deps
 */
function createPaymentUi(deps) {
    const { Msg, logger, lastMenuMsg, Markup, bot, prisma, MP, comprasPendentes, cartKey, CONFIG } = deps;

    async function resolvePaymentSlot(ctx) {
        const cqMsg = ctx.callbackQuery?.message;
        const chatId = cqMsg?.chat?.id || ctx.chat?.id;
        const uid = String(ctx.from?.id || chatId);
        let messageId = cqMsg?.message_id;
        if (lastMenuMsg && uid) {
            try {
                const slot = await lastMenuMsg.get(uid);
                const tracked = slotMessageId(slot);
                if (tracked) messageId = tracked;
            } catch {
                /* ignore */
            }
        }
        return { chatId, messageId, uid };
    }

    function pixPaymentKeyboard(orderId) {
        const { PAY_BTN } = require('../../menus/menuCopy');
        return Markup.inlineKeyboard([
            [{ text: PAY_BTN.copyPix, callback_data: `copypix_${orderId}` }],
            [{ text: PAY_BTN.card.replace(' ou boleto', ''), callback_data: `pc_${orderId}` }],
            [
                { text: PAY_BTN.verify, callback_data: `check_${orderId}` },
                { text: PAY_BTN.cancel, callback_data: `cancel_${orderId}` },
            ],
        ]);
    }

    async function resolveOrderProductPhoto(pending) {
        const pid = pending?.items?.[0]?.product_id;
        if (!pid || !prisma?.product?.findUnique) return null;
        try {
            const p = await prisma.product.findUnique({ where: { id: pid } });
            if (!p) return null;
            return resolveProductPhotoInput(p, CONFIG?.CAMINHO_FOTOS || null);
        } catch {
            return null;
        }
    }

    async function replacePaymentMessage(ctx, text, markup, { photo = null, preferProductPhoto = false } = {}) {
        const { chatId, messageId, uid } = await resolvePaymentSlot(ctx);
        const opts = pickTelegramOpts({
            parse_mode: 'HTML',
            ...(markup ? { reply_markup: unwrapReplyMarkup(markup) } : {}),
        });
        const caption = truncateTelegramHtml(text, CAPTION_MAX - 16);

        let mediaPhoto = photo;
        if (!mediaPhoto && preferProductPhoto) {
            const pending = await comprasPendentes.get(cartKey(ctx)).catch(() => null);
            if (pending?.orderKind === 'smm') {
                const { getScreenPhotoInput } = require('../../screenPhoto');
                mediaPhoto = resolvePhotoInput(getScreenPhotoInput('wallet', ctx.from?.id || chatId));
                if (!mediaPhoto) {
                    const { getMenuPhotoInput } = require('../../menuPhoto');
                    mediaPhoto = resolvePhotoInput(getMenuPhotoInput(ctx.from?.id || chatId));
                }
            } else if (pending?.orderKind === 'virtuo') {
                const { getScreenPhotoInput } = require('../../screenPhoto');
                mediaPhoto = resolvePhotoInput(getScreenPhotoInput('virtuo', ctx.from?.id || chatId))
                    || resolvePhotoInput(getScreenPhotoInput('wallet', ctx.from?.id || chatId));
            } else if (pending) {
                mediaPhoto = await resolveOrderProductPhoto(pending);
            }
        }

        if (messageId && chatId) {
            const resolvedMedia = mediaPhoto ? resolvePhotoInput(mediaPhoto) || mediaPhoto : null;
            if (resolvedMedia && !isLocalFilePhotoInput(resolvedMedia)) {
                const ok = await tryEditPhotoMessage(ctx.telegram, chatId, messageId, resolvedMedia, text, opts);
                if (ok) {
                    await lastMenuMsg.set(uid, { messageId, chatId: uid });
                    return true;
                }
            } else if (!resolvedMedia) {
                const ok = await tryEditMessage(ctx.telegram, chatId, messageId, text, opts);
                if (ok) {
                    await lastMenuMsg.set(uid, { messageId, chatId: uid });
                    return true;
                }
            }
            await ctx.telegram.deleteMessage(chatId, messageId).catch(() => { });
        }

        let sent;
        if (mediaPhoto) {
            sent = await ctx.telegram.sendPhoto(chatId, mediaPhoto, { caption, ...opts });
        } else {
            sent = await ctx.telegram.sendMessage(chatId, text, opts);
        }
        await lastMenuMsg.set(uid, { messageId: sent.message_id, chatId: uid });
        return true;
    }

    async function editPaymentScreen(ctx, text, markup, options = {}) {
        const preferProductPhoto = options.preferProductPhoto !== false && !options.pixQr;
        const ok = await replacePaymentMessage(ctx, text, markup, {
            photo: options.photo || null,
            preferProductPhoto,
        });
        if (ok) return true;

        try {
            const r = await Msg.edit(ctx, text, markup, {
                useMenuPhoto: true,
                skipMenuPhoto: false,
                noFallback: true,
            });
            if (r?.messageId) return true;
        } catch (e) {
            logger.warn('[editPaymentScreen] Msg.edit failed', { message: e?.message });
        }
        return replacePaymentMessage(ctx, text, markup, {
            photo: options.photo || null,
            preferProductPhoto,
        });
    }

    async function showPixQrPaymentScreen(ctx, pending, orderId, msgText) {
        const markup = pixPaymentKeyboard(orderId);
        const opts = pickTelegramOpts({
            parse_mode: 'HTML',
            reply_markup: unwrapReplyMarkup(markup),
        });
        const caption = truncateTelegramHtml(msgText, CAPTION_MAX - 16);
        const { chatId, messageId, uid } = await resolvePaymentSlot(ctx);

        if (!pending.pixQrCodeBase64 || !chatId) {
            return editPaymentScreen(ctx, msgText, markup, { preferProductPhoto: false });
        }

        const buffer = Buffer.from(pending.pixQrCodeBase64, 'base64');

        if (messageId) {
            try {
                await ctx.telegram.editMessageMedia(
                    chatId,
                    messageId,
                    undefined,
                    { type: 'photo', media: { source: buffer }, caption, parse_mode: 'HTML' },
                    opts.reply_markup ? { reply_markup: opts.reply_markup } : {}
                );
                if (opts.reply_markup?.inline_keyboard?.length) {
                    await ctx.telegram.editMessageReplyMarkup(chatId, messageId, undefined, opts.reply_markup).catch(() => { });
                }
                await lastMenuMsg.set(uid, { messageId, chatId: uid });
                try {
                    const { schedulePixAutoPoll } = require('../../../modules/payment/pixAutoPoll');
                    schedulePixAutoPoll(orderId, ctx, { prisma, bot, MP, comprasPendentes, cartKey, log: logger });
                } catch { /* ignore */ }
                return true;
            } catch (e) {
                if (isIgnorableEditError(e)) {
                    await lastMenuMsg.set(uid, { messageId, chatId: uid });
                    try {
                        const { schedulePixAutoPoll } = require('../../../modules/payment/pixAutoPoll');
                        schedulePixAutoPoll(orderId, ctx, { prisma, bot, MP, comprasPendentes, cartKey, log: logger });
                    } catch { /* ignore */ }
                    return true;
                }
                if (!isMissingMessageEditError(e)) {
                    logger.warn('[PIX] editMessageMedia failed, replace in-place', { message: e?.message, mid: messageId });
                }
                await ctx.telegram.deleteMessage(chatId, messageId).catch(() => { });
            }
        }

        const sent = await ctx.telegram.sendPhoto(chatId, { source: buffer }, { caption, ...opts });
        await lastMenuMsg.set(uid, { messageId: sent.message_id, chatId: uid });
        try {
            const { schedulePixAutoPoll } = require('../../../modules/payment/pixAutoPoll');
            schedulePixAutoPoll(orderId, ctx, { prisma, bot, MP, comprasPendentes, cartKey, log: logger });
        } catch { /* ignore */ }
        return true;
    }

    return { pixPaymentKeyboard, editPaymentScreen, showPixQrPaymentScreen, resolveOrderProductPhoto };
}

module.exports = { createPaymentUi };
