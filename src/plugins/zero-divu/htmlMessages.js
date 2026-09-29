'use strict';

/**
 * Mensagens HTML longas no Telegram — divisão por linhas (sem cortar tags).
 * Usado por /help, listas admin, relatórios, etc.
 */

const { CAPTION_MAX } = require('./telegramLimits');

const TELEGRAM_HTML_CHUNK = 3900;

function packLinesIntoMessages(lines, maxLen = TELEGRAM_HTML_CHUNK) {
    const messages = [];
    let buf = '';

    const flush = () => {
        const t = buf.trimEnd();
        if (t) messages.push(t);
        buf = '';
    };

    for (const raw of lines) {
        const line = raw.length && raw.endsWith('\n') ? raw : `${raw}\n`;
        if (line.length > maxLen) {
            flush();
            let rest = line;
            while (rest.length > maxLen) {
                messages.push(rest.slice(0, maxLen).trimEnd());
                rest = rest.slice(maxLen);
            }
            buf = rest;
            continue;
        }
        if (buf.length + line.length > maxLen) flush();
        buf += line;
    }
    flush();
    return messages.length ? messages : [''];
}

function packBlocksIntoMessages(blocks, maxLen = TELEGRAM_HTML_CHUNK) {
    const messages = [];
    let buf = '';

    for (const block of blocks) {
        const b = (block || '').trimEnd();
        if (!b) continue;
        const candidate = buf ? `${buf}\n${b}` : b;
        if (candidate.length <= maxLen) {
            buf = candidate;
            continue;
        }
        if (buf) {
            messages.push(buf);
            buf = '';
        }
        if (b.length <= maxLen) {
            buf = b;
        } else {
            messages.push(...packLinesIntoMessages(b.split('\n'), maxLen));
        }
    }
    if (buf) messages.push(buf);
    return messages.length ? messages : [''];
}

function formatHtmlPart(body, index, total) {
    return total > 1 ? `${body}\n\n<i>(${index + 1}/${total})</i>` : body;
}

function partsFromHtml(text, maxLen = TELEGRAM_HTML_CHUNK) {
    return packLinesIntoMessages(String(text || '').split('\n'), maxLen);
}

function needsLongDelivery(text, maxLen = CAPTION_MAX) {
    return String(text || '').length > maxLen;
}

/**
 * Envia HTML em uma ou mais mensagens de texto (até ~3900 chars cada).
 * Usa sendSide no PV para não truncar em legenda de foto de menu.
 */
async function sendLongHtml(ctx, textOrParts, markup = null, options = {}) {
    const Msg = options.Msg || require('./Msg').Msg.instance;
    const Markup = options.Markup || require('telegraf').Markup;
    const { tryEditMessage, pickTelegramOpts, unwrapReplyMarkup } = require('./messageDelivery');
    const parts = Array.isArray(textOrParts) ? textOrParts : partsFromHtml(textOrParts);
    const kb = markup?.reply_markup || markup;
    const markupLast = kb ? Markup.inlineKeyboard(kb.inline_keyboard || kb) : null;
    const editFirst = !!options.editFirst && !!ctx.callbackQuery;
    const sideOpts = { sendSide: true, skipMenuPhoto: true, skipLongSplit: true };

    for (let i = 0; i < parts.length; i++) {
        const chunk = formatHtmlPart(parts[i], i, parts.length);
        const isLast = i === parts.length - 1;
        const mk = isLast ? markupLast : null;

        if (i === 0 && editFirst) {
            const chatId = ctx.chat?.id;
            const msgId = ctx.callbackQuery?.message?.message_id;
            const telegram = ctx.telegram;
            const editOpts = pickTelegramOpts({
                parse_mode: 'HTML',
                ...(mk ? { reply_markup: unwrapReplyMarkup(mk) } : {}),
            });
            let ok = false;
            if (msgId && chatId && telegram) {
                ok = await tryEditMessage(telegram, chatId, msgId, chunk, editOpts);
            }
            if (!ok) {
                await Msg.sendSide(ctx, chunk, mk, sideOpts);
            }
        } else {
            await Msg.reply(ctx, chunk, mk, sideOpts);
        }
    }
}

module.exports = {
    TELEGRAM_HTML_CHUNK,
    CAPTION_MAX,
    packLinesIntoMessages,
    packBlocksIntoMessages,
    partsFromHtml,
    formatHtmlPart,
    needsLongDelivery,
    sendLongHtml,
};
