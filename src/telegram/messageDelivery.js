'use strict';

/**
 * Entrega unificada Telegram — PV/menu: edita slot; grupos (promoMode+replace): apaga e manda nova;
 * PV divulgação (pvPromo): edita slot — nunca apaga+nova; 1ª vez sem slot envia uma única mensagem.
 * Usado por Msg, BroadcastService e MsgService (PV + grupos).
 */

const fs = require('fs');
const path = require('path');
const { resolveLocalFile } = require('../utils/safeLocalPath');
const { truncateTelegramHtml, isCaptionTooLongError, CAPTION_MAX, MESSAGE_MAX } = require('./telegramLimits');

const TELEGRAM_API_TIMEOUT_MS = Number(process.env.TELEGRAM_API_TIMEOUT_MS) || 25000;

function isNetworkError(err) {
    const msg = (err?.description || err?.message || String(err)).toLowerCase();
    return (
        msg.includes('eai_again') ||
        msg.includes('etimedout') ||
        msg.includes('econnreset') ||
        msg.includes('enotfound') ||
        msg.includes('network') ||
        msg.includes('fetch failed') ||
        msg.includes('socket hang up')
    );
}

function formatNetworkErr(err) {
    if (!err) return '';
    const parts = [err.message, err.code, err.cause?.message, err.cause?.code].filter(Boolean);
    const joined = parts.join(' · ').trim();
    return joined || String(err);
}

function withTelegramTimeout(promise, ms = TELEGRAM_API_TIMEOUT_MS) {
    return Promise.race([
        promise,
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Telegram API timeout (${ms}ms)`)), ms)
        ),
    ]);
}

function getProductPhotoDirs() {
    const dirs = [path.join(__dirname, '../../fotos')];
    try {
        const cfg = require('../config/config');
        if (cfg.CAMINHO_FOTOS) dirs.push(cfg.CAMINHO_FOTOS);
    } catch {
        /* ignore */
    }
    if (process.env.CAMINHO_FOTOS) dirs.push(process.env.CAMINHO_FOTOS);
    return [...new Set(dirs.map((d) => path.normalize(String(d))))];
}

function resolveLocalPhotoPath(ref, scope = 'product') {
    if (!ref || typeof ref !== 'string') return null;
    const dirs =
        scope === 'menu'
            ? (() => {
                  try {
                      return require('./menuPhoto').resolveMenuDirs();
                  } catch {
                      return [];
                  }
              })()
            : getProductPhotoDirs();
    for (const dir of dirs) {
        const fp = resolveLocalFile(dir, ref);
        if (fp) return fp;
    }
    return null;
}

function isIgnorableEditError(err) {
    const msg = err?.description || err?.message || '';
    return msg.includes('message is not modified');
}

/** Mensagem sumiu ou não é editável — deve enviar nova, não fingir sucesso */
function isMissingMessageEditError(err) {
    const msg = err?.description || err?.message || '';
    return (
        msg.includes('message to edit not found') ||
        msg.includes("message can't be edited") ||
        msg.includes('there is no text in the message to edit') ||
        msg.includes('there is no caption in the message to edit') ||
        msg.includes('MESSAGE_ID_INVALID') ||
        msg.includes('message identifier is not specified') ||
        msg.includes('message is too long') ||
        msg.includes('MEDIA_EMPTY')
    );
}

function isMarkupEditError(err) {
    const msg = err?.description || err?.message || '';
    return (
        msg.includes('REPLY_MARKUP_INVALID') ||
        msg.includes('BUTTON_URL_INVALID') ||
        msg.includes('BUTTON_USER_PRIVACY_RESTRICTED')
    );
}

function isBlockedError(err) {
    const msg = (err?.description || err?.message || '').toLowerCase();
    return (
        err?.code === 403 ||
        msg.includes('blocked') ||
        msg.includes('deactivated') ||
        msg.includes('chat not found') ||
        msg.includes('user not found') ||
        msg.includes('bot_to_bot') ||
        msg.includes('user_is_bot') ||
        msg.includes("bots can't send") ||
        msg.includes("have no rights to send") ||
        msg.includes('chat_write_forbidden') ||
        msg.includes('not enough rights')
    );
}

function isPhotoForbiddenError(err) {
    const msg = String(err?.description || err?.message || err || '').toUpperCase();
    return (
        msg.includes('CHAT_SEND_PHOTOS_FORBIDDEN') ||
        msg.includes('ALLOW_PAYMENT_REQUIRED') ||
        msg.includes('MEDIA_INVALID') ||
        msg.includes('PHOTO_INVALID') ||
        msg.includes('PHOTO_CROP_SIZE_SMALL')
    );
}

/** Chave única do slot (DB/Redis) — evita número vs string no mesmo grupo */
function normalizeSlotChatId(chatId) {
    if (chatId == null) return null;
    return String(chatId);
}

/** ID numérico para API Telegram */
function telegramChatId(chatId) {
    const s = normalizeSlotChatId(chatId);
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : s;
}

function slotMessageId(slot) {
    if (!slot) return null;
    const id = slot.messageId ?? slot.message_id;
    if (id == null) return null;
    const n = Number(id);
    return Number.isFinite(n) ? n : null;
}

const TELEGRAM_SEND_KEYS = new Set([
    'parse_mode',
    'reply_markup',
    'disable_web_page_preview',
    'disable_notification',
    'protect_content',
    'message_thread_id',
    'link_preview_options',
]);

/**
 * Telegraf Markup.inlineKeyboard() → { reply_markup: { inline_keyboard } }.
 * Broadcast passava isso de novo em reply_markup e o Telegram ignorava os botões.
 */
function unwrapReplyMarkup(markup) {
    if (!markup) return undefined;
    const kb = markup.reply_markup?.inline_keyboard || markup.inline_keyboard;
    if (markup.__hanorkPrebuilt && kb?.length) {
        return { inline_keyboard: kb };
    }
    const { normalizeReplyMarkup } = require('./menus/twoColKeyboard');
    if (markup.inline_keyboard) {
        return normalizeReplyMarkup({ inline_keyboard: markup.inline_keyboard });
    }
    if (markup.reply_markup) {
        if (markup.reply_markup.__hanorkPrebuilt && markup.reply_markup.inline_keyboard?.length) {
            return { inline_keyboard: markup.reply_markup.inline_keyboard };
        }
        return unwrapReplyMarkup(markup.reply_markup);
    }
    return normalizeReplyMarkup(markup);
}

/** Remove metadados internos (cooldownMs, photo, etc.) antes de chamar a API */
function pickTelegramOpts(markupOrOpts = {}) {
    const raw =
        markupOrOpts?.parse_mode || markupOrOpts?.reply_markup || markupOrOpts?.inline_keyboard
            ? { ...markupOrOpts }
            : { parse_mode: 'HTML', ...markupOrOpts };
    const opts = { parse_mode: 'HTML' };
    for (const [k, v] of Object.entries(raw)) {
        if (k === 'reply_markup') continue;
        if (TELEGRAM_SEND_KEYS.has(k) && v !== undefined) {
            opts[k] = v;
        }
    }
    const rm = unwrapReplyMarkup(raw.reply_markup) || unwrapReplyMarkup(raw);
    if (rm?.inline_keyboard?.length) {
        opts.reply_markup = rm;
    }
    return opts;
}

function normalizeOpts(text, markupOrOpts = {}) {
    const opts =
        markupOrOpts?.parse_mode || markupOrOpts?.reply_markup || markupOrOpts?.inline_keyboard
            ? { ...markupOrOpts }
            : { parse_mode: 'HTML' };
    if (!opts.parse_mode) opts.parse_mode = 'HTML';
    const rm =
        unwrapReplyMarkup(markupOrOpts?.reply_markup) ||
        unwrapReplyMarkup(markupOrOpts);
    if (rm?.inline_keyboard?.length) {
        opts.reply_markup = rm;
    }
    return opts;
}

function isUsablePhotoUrl(value) {
    if (!value || typeof value !== 'string') return false;
    if (!/^https?:\/\//i.test(value)) return false;
    try {
        return Boolean(new URL(value).hostname);
    } catch {
        return false;
    }
}

function resolveExistingLocalPath(ref) {
    if (!ref || typeof ref !== 'string') return null;
    const normalized = path.normalize(ref.trim());
    if (!path.isAbsolute(normalized)) return null;
    try {
        if (fs.existsSync(normalized)) return normalized;
    } catch {
        /* ignore */
    }
    return null;
}

function isTelegramFileId(value) {
    if (typeof value !== 'string' || value.length < 10) return false;
    if (value.includes('/') || value.includes('\\')) return false;
    if (isUsablePhotoUrl(value)) return false;
    return /^[\w-]+$/.test(value);
}

/** Arquivo local — editMessageMedia costuma gerar foto preta; preferir apagar+reenviar. */
function isLocalFilePhotoInput(photoInput) {
    if (!photoInput) return false;
    if (typeof photoInput === 'object' && photoInput.source != null) {
        const src = photoInput.source;
        if (typeof src !== 'string') return false;
        if (isUsablePhotoUrl(src) || isTelegramFileId(src)) return false;
        try {
            return fs.existsSync(src) && fs.statSync(src).isFile();
        } catch {
            return false;
        }
    }
    if (typeof photoInput === 'string') {
        if (isUsablePhotoUrl(photoInput) || isTelegramFileId(photoInput)) return false;
        try {
            return fs.existsSync(photoInput) && fs.statSync(photoInput).isFile();
        } catch {
            return false;
        }
    }
    return false;
}

function resolvePhotoInput(photoOrUrl) {
    if (!photoOrUrl) return null;
    if (typeof photoOrUrl === 'string') {
        if (isUsablePhotoUrl(photoOrUrl)) return photoOrUrl;
        const direct = resolveExistingLocalPath(photoOrUrl);
        if (direct) return { source: direct };
        const menuFp = resolveLocalPhotoPath(photoOrUrl, 'menu');
        if (menuFp) return { source: menuFp };
        const fp = resolveLocalPhotoPath(photoOrUrl);
        if (fp) return { source: fp };
        if (isTelegramFileId(photoOrUrl)) return photoOrUrl;
        return null;
    }
    if (typeof photoOrUrl === 'object' && photoOrUrl.source != null) {
        const src = photoOrUrl.source;
        if (typeof src === 'string') {
            if (isUsablePhotoUrl(src)) return src;
            const direct = resolveExistingLocalPath(src);
            if (direct) return { source: direct };
            const menuFp = resolveLocalPhotoPath(src, 'menu');
            if (menuFp) return { source: menuFp };
            const fp = resolveLocalPhotoPath(src);
            if (fp) return { source: fp };
        } else {
            return photoOrUrl;
        }
    }
    return null;
}

/** Remove mensagem rastreada do bot (slot) — falha silenciosa se já sumiu */
async function deleteSlotMessage(telegram, chatId, slot) {
    const id = slotMessageId(slot);
    if (!id) return false;
    try {
        await telegram.deleteMessage(telegramChatId(chatId), id);
        return true;
    } catch {
        return false;
    }
}

/**
 * Edita texto ou legenda + teclado na mensagem existente.
 */
async function tryEditMessage(telegram, chatId, messageId, text, opts) {
    const cid = telegramChatId(chatId);
    const editMax = MESSAGE_MAX - 24;
    const safeText =
        (text || '').length > editMax ? truncateTelegramHtml(text, editMax) : text || '';
    const { reply_markup, ...textOnlyOpts } = opts || {};
    const attempts = [
        () => telegram.editMessageText(cid, messageId, undefined, safeText, opts),
        () => telegram.editMessageCaption(cid, messageId, undefined, safeText, opts),
        () => telegram.editMessageText(cid, messageId, undefined, safeText, textOnlyOpts),
        () => telegram.editMessageCaption(cid, messageId, undefined, safeText, textOnlyOpts),
    ];
    if (reply_markup?.inline_keyboard?.length) {
        attempts.push(() =>
            telegram.editMessageReplyMarkup(cid, messageId, undefined, reply_markup)
        );
        attempts.push(() =>
            telegram.editMessageText(cid, messageId, undefined, safeText, {
                ...textOnlyOpts,
                reply_markup,
            })
        );
        attempts.push(() =>
            telegram.editMessageCaption(cid, messageId, undefined, safeText, {
                ...textOnlyOpts,
                reply_markup,
            })
        );
    }
    for (const run of attempts) {
        try {
            await withTelegramTimeout(run());
            return true;
        } catch (e) {
            if (isIgnorableEditError(e)) return true;
            if (isMissingMessageEditError(e)) return false;
            if (isMarkupEditError(e)) continue;
        }
    }
    return false;
}

/** Converte input de foto (URL / arquivo local) para media do editMessageMedia. */
function buildPhotoMediaInput(photoInput) {
    if (!photoInput) return null;
    if (typeof photoInput === 'string') return photoInput;
    if (typeof photoInput === 'object' && photoInput.source != null) {
        return typeof photoInput.source === 'string' ? { source: photoInput.source } : photoInput;
    }
    return photoInput;
}

/**
 * Edita foto + legenda na mensagem existente (mesma lógica dos menus do bot).
 */
async function tryEditPhotoMessage(telegram, chatId, messageId, photoInput, text, opts) {
    const cid = telegramChatId(chatId);
    const media = buildPhotoMediaInput(photoInput);
    if (!media) return false;

    const caption = truncateTelegramHtml(text || '', CAPTION_MAX - 16);
    const { reply_markup, parse_mode, ...restOpts } = opts || {};
    const inputMedia = {
        type: 'photo',
        media,
        caption,
        parse_mode: parse_mode || 'HTML',
    };

    const extra = reply_markup?.inline_keyboard?.length ? { reply_markup } : {};

    try {
        await withTelegramTimeout(
            telegram.editMessageMedia(cid, messageId, undefined, inputMedia, extra)
        );
        if (reply_markup?.inline_keyboard?.length) {
            await withTelegramTimeout(
                telegram.editMessageReplyMarkup(cid, messageId, undefined, reply_markup)
            ).catch(() => {});
        }
        return true;
    } catch (e) {
        if (isIgnorableEditError(e)) return true;
        if (isMissingMessageEditError(e)) return false;
        if (isMarkupEditError(e)) {
            try {
                await withTelegramTimeout(
                    telegram.editMessageMedia(cid, messageId, undefined, {
                        type: 'photo',
                        media,
                        caption,
                        parse_mode: parse_mode || 'HTML',
                    })
                );
                return true;
            } catch {
                return false;
            }
        }
        return false;
    }
}

/**
 * PV divulgação — edita a mensagem rastreada; nunca apaga+nova (anti-flood).
 * Só envia mensagem nova na primeira vez (sem slot).
 */
function resolvePvPromoPhotoInput(options, chatId) {
    let photoInput = resolvePhotoInput(options.photo);
    if (!photoInput && options.requirePhoto) {
        try {
            const { getMenuPhotoInput } = require('./menuPhoto');
            const menuRaw = getMenuPhotoInput(chatId, `pv-promo:${chatId}`, null, { rotate: false });
            photoInput = resolvePhotoInput(menuRaw);
        } catch {
            /* ignore */
        }
    }
    return photoInput;
}

async function deliverPvPromo(telegram, chatId, slotId, text, opts, options = {}) {
    const cid = telegramChatId(chatId);
    const photoInput = resolvePvPromoPhotoInput(options, chatId);
    const slotIsText = options.messageIsPhoto === false;
    const editOnly = !!options.editOnly;
    const textTooLongForCaption = (text || '').length > CAPTION_MAX;
    const msgMax = MESSAGE_MAX - 24;
    const safeText =
        (text || '').length > msgMax ? truncateTelegramHtml(text, msgMax) : text || '';

    if (slotId) {
        if (photoInput && !slotIsText && !options.reuseMedia) {
            const ok = await tryEditPhotoMessage(telegram, cid, slotId, photoInput, text, opts);
            if (ok) return { action: 'edited', messageId: slotId };
        }
        const ok = await tryEditMessage(telegram, cid, slotId, text, opts);
        if (ok) return { action: 'edited', messageId: slotId };
        return { action: 'unchanged', messageId: slotId, reason: 'pv_edit_failed' };
    }

    if (editOnly) {
        return { action: 'skipped', messageId: null, reason: 'pv_edit_only_no_slot' };
    }

    try {
        let sent;
        if (photoInput) {
            const caption = truncateTelegramHtml(text, CAPTION_MAX - 16);
            try {
                sent = await withTelegramTimeout(telegram.sendPhoto(cid, photoInput, { caption, ...opts }));
            } catch (photoErr) {
                if (
                    isCaptionTooLongError(photoErr) ||
                    isPhotoForbiddenError(photoErr) ||
                    isNetworkError(photoErr)
                ) {
                    sent = await withTelegramTimeout(telegram.sendMessage(cid, safeText, opts));
                    if (isPhotoForbiddenError(photoErr)) {
                        return {
                            action: 'sent',
                            messageId: sent.message_id,
                            photoFallback: true,
                            photoFallbackReason: String(
                                photoErr?.description || photoErr?.message || photoErr
                            ).slice(0, 160),
                        };
                    }
                    if (isNetworkError(photoErr)) {
                        return {
                            action: 'sent',
                            messageId: sent.message_id,
                            photoFallback: true,
                            photoFallbackReason: 'network',
                        };
                    }
                } else {
                    throw photoErr;
                }
            }
        } else if (options.requirePhoto && !photoInput) {
            throw new Error('requirePhoto: nenhuma foto de menu disponível (infos/menu.jpg, menu2.jpg, …)');
        } else {
            sent = await withTelegramTimeout(telegram.sendMessage(cid, safeText, opts));
        }
        return { action: 'sent', messageId: sent.message_id };
    } catch (err) {
        if (isBlockedError(err)) {
            return { action: 'blocked', messageId: null };
        }
        if ((photoInput || textTooLongForCaption) && isCaptionTooLongError(err)) {
            const sent = await withTelegramTimeout(telegram.sendMessage(cid, safeText, opts));
            return { action: 'sent', messageId: sent.message_id };
        }
        throw err;
    }
}

/**
 * Entrega em chat: edita slot rastreado; só envia nova se não houver mensagem ou edição impossível.
 * @param {object} slot - { messageId }
 * @returns {{ action: 'edited'|'unchanged'|'sent', messageId: number }}
 */
async function deliverMessage(telegram, chatId, slot, text, markupOrOpts = {}, options = {}) {
    const cid = telegramChatId(chatId);
    const opts = pickTelegramOpts(markupOrOpts);
    const slotId = slotMessageId(slot);
    const forceNew = !!options.forceNew;
    const promoMode = !!options.promoMode;
    const pvPromo = !!options.pvPromo;

    if (pvPromo) {
        return deliverPvPromo(telegram, chatId, slotId, text, opts, options);
    }

    const replaceNotEdit = forceNew || (promoMode && options.groupPromoReplace);
    let messageId = replaceNotEdit ? null : slotId;
    let photoInput = resolvePhotoInput(options.photo);
    const requirePhoto = !!options.requirePhoto;
    const textTooLongForCaption = (text || '').length > CAPTION_MAX;

    async function clearTrackedBeforeSend() {
        if (!messageId) return;
        try {
            await telegram.deleteMessage(cid, messageId);
        } catch {
            /* já apagada */
        }
        messageId = null;
    }

    // Grupos/canais: apaga promo anterior e manda mensagem nova (visível no feed)
    if (replaceNotEdit && slotId) {
        await deleteSlotMessage(telegram, chatId, slot);
        messageId = null;
    }

    if (messageId && !photoInput) {
        const canEditInPlace = options.messageIsPhoto !== false && !promoMode;
        const captionOnly = !!options.reuseMedia || !requirePhoto;
        if (canEditInPlace && captionOnly) {
            const ok = await tryEditMessage(telegram, cid, messageId, text, opts);
            if (ok) {
                return { action: 'edited', messageId };
            }
        }
    } else if (messageId && photoInput) {
        const localPhotoFile = isLocalFilePhotoInput(photoInput);
        if (!localPhotoFile && (options.reuseMedia || options.photoChanged === false)) {
            const ok = await tryEditMessage(telegram, cid, messageId, text, opts);
            if (ok) {
                return { action: 'edited', messageId };
            }
        }
        const ok = await tryEditPhotoMessage(telegram, cid, messageId, photoInput, text, opts);
        if (ok) {
            return { action: 'edited', messageId };
        }
    }

    await clearTrackedBeforeSend();

    const msgMax = MESSAGE_MAX - 24;
    const safeText =
        (text || '').length > msgMax ? truncateTelegramHtml(text, msgMax) : text || '';

    try {
        let sent;
        if (photoInput) {
            const caption = truncateTelegramHtml(text, CAPTION_MAX - 16);
            try {
                sent = await withTelegramTimeout(telegram.sendPhoto(cid, photoInput, { caption, ...opts }));
            } catch (photoErr) {
                if (
                    isCaptionTooLongError(photoErr) ||
                    isPhotoForbiddenError(photoErr) ||
                    isNetworkError(photoErr)
                ) {
                    await clearTrackedBeforeSend();
                    sent = await withTelegramTimeout(telegram.sendMessage(cid, safeText, opts));
                    if (isPhotoForbiddenError(photoErr)) {
                        return {
                            action: 'sent',
                            messageId: sent.message_id,
                            photoFallback: true,
                            photoFallbackReason: String(
                                photoErr?.description || photoErr?.message || photoErr
                            ).slice(0, 160),
                        };
                    }
                    if (isNetworkError(photoErr)) {
                        return {
                            action: 'sent',
                            messageId: sent.message_id,
                            photoFallback: true,
                            photoFallbackReason: 'network',
                        };
                    }
                } else {
                    throw photoErr;
                }
            }
        } else if (requirePhoto && !photoInput) {
            throw new Error('requirePhoto: nenhuma foto de menu disponível (infos/menu.jpg, menu2.jpg, …)');
        } else {
            sent = await withTelegramTimeout(telegram.sendMessage(cid, safeText, opts));
        }
        return { action: 'sent', messageId: sent.message_id };
    } catch (err) {
        if (isBlockedError(err)) {
            return { action: 'blocked', messageId: null };
        }
        if ((photoInput || textTooLongForCaption) && isCaptionTooLongError(err)) {
            await clearTrackedBeforeSend();
            const sent = await withTelegramTimeout(telegram.sendMessage(cid, safeText, opts));
            return { action: 'sent', messageId: sent.message_id };
        }
        throw err;
    }
}

module.exports = {
    deliverMessage,
    deleteSlotMessage,
    tryEditMessage,
    tryEditPhotoMessage,
    buildPhotoMediaInput,
    normalizeOpts,
    unwrapReplyMarkup,
    pickTelegramOpts,
    normalizeSlotChatId,
    telegramChatId,
    slotMessageId,
    isIgnorableEditError,
    isMissingMessageEditError,
    isMarkupEditError,
    isBlockedError,
    isPhotoForbiddenError,
    isLocalFilePhotoInput,
    resolvePhotoInput,
    isUsablePhotoUrl,
    getProductPhotoDirs,
    withTelegramTimeout,
    isNetworkError,
    formatNetworkErr,
    TELEGRAM_API_TIMEOUT_MS,
};
