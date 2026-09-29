'use strict';

/** Limite da API Telegram para texto de botão inline. */
const TG_BUTTON_TEXT_MAX = 64;

/**
 * Garante string válida em UTF-8 (remove surrogates órfãos e controles).
 * A API do Telegram rejeita botões com sequências UTF-8 inválidas.
 */
function toValidUtf8(text) {
    let s = String(text ?? '');
    s = s.replace(/[\uD800-\uDFFF]/g, '');
    s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    s = s.replace(/\uFEFF/g, '');
    try {
        return Buffer.from(s, 'utf8').toString('utf8');
    } catch {
        return '';
    }
}

/**
 * Trunca por code points (não parte emoji/surrogates no meio).
 */
function truncateUnicode(text, max = TG_BUTTON_TEXT_MAX) {
    const safe = toValidUtf8(text).replace(/\s+/g, ' ').trim();
    if (!safe) return '';
    const limit = Math.max(1, Number(max) || TG_BUTTON_TEXT_MAX);
    const chars = [...safe];
    if (chars.length <= limit) return safe;
    if (limit <= 1) return chars.slice(0, limit).join('');
    return `${chars.slice(0, limit - 1).join('')}…`;
}

/** Texto seguro para botão inline (UTF-8 + limite Telegram). */
function truncateButtonText(text, max = TG_BUTTON_TEXT_MAX) {
    const out = truncateUnicode(text, max);
    return out || '…';
}

function sanitizeInlineButton(button) {
    if (!button || typeof button !== 'object') return button;
    const out = { ...button };
    if (typeof out.text === 'string') {
        out.text = truncateButtonText(out.text, TG_BUTTON_TEXT_MAX);
    }
    return out;
}

function sanitizeInlineKeyboardRows(rows) {
    if (!Array.isArray(rows)) return rows;
    return rows.map((row) => (Array.isArray(row) ? row.map(sanitizeInlineButton) : row));
}

function sanitizeReplyMarkup(markup) {
    if (!markup || typeof markup !== 'object') return markup;
    if (Array.isArray(markup)) {
        return { inline_keyboard: sanitizeInlineKeyboardRows(markup) };
    }
    if (markup.inline_keyboard?.length) {
        return {
            ...markup,
            inline_keyboard: sanitizeInlineKeyboardRows(markup.inline_keyboard),
        };
    }
    if (markup.reply_markup) {
        const inner = sanitizeReplyMarkup(markup.reply_markup);
        if (inner === markup.reply_markup) return markup;
        return { ...markup, reply_markup: inner };
    }
    return markup;
}

module.exports = {
    TG_BUTTON_TEXT_MAX,
    toValidUtf8,
    truncateUnicode,
    truncateButtonText,
    sanitizeInlineButton,
    sanitizeInlineKeyboardRows,
    sanitizeReplyMarkup,
};
