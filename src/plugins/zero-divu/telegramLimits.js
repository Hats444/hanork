'use strict';

/** Limites oficiais Telegram Bot API */
const CAPTION_MAX = 1024;
const MESSAGE_MAX = 4096;

/**
 * Trunca HTML para caber em legenda/mensagem sem quebrar tags grosseiramente.
 */
function truncateTelegramHtml(text, maxLen = CAPTION_MAX) {
    if (!text || text.length <= maxLen) return text || '';
    let cut = text.slice(0, maxLen - 20);
    const lastNl = cut.lastIndexOf('\n');
    if (lastNl > maxLen * 0.55) cut = cut.slice(0, lastNl);
    const openTags = (cut.match(/<([a-z]+)(?:\s[^>]*)?>/gi) || []).map((t) => t.match(/<([a-z]+)/i)?.[1]?.toLowerCase()).filter(Boolean);
    const closeTags = (cut.match(/<\/([a-z]+)>/gi) || []).map((t) => t.match(/<\/([a-z]+)/i)?.[1]?.toLowerCase()).filter(Boolean);
    for (let i = openTags.length - 1; i >= 0; i--) {
        const tag = openTags[i];
        const opens = openTags.slice(0, i + 1).filter((t) => t === tag).length;
        const closes = closeTags.filter((t) => t === tag).length;
        if (opens > closes) cut += `</${tag}>`;
    }
    return `${cut}\n\n<i>…</i>`;
}

function isCaptionTooLongError(err) {
    const msg = err?.description || err?.message || '';
    return msg.includes('caption is too long') || msg.includes('CAPTION_TOO_LONG');
}

module.exports = {
    CAPTION_MAX,
    MESSAGE_MAX,
    truncateTelegramHtml,
    isCaptionTooLongError,
};
