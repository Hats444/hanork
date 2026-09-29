'use strict';

/** Limite seguro de legenda em status WhatsApp (imagem). */
const WA_CAPTION_MAX = 1024;

const TG_LINK_RE = /https?:\/\/t\.me\/[^\s<>)]+/i;

function normalizeUsername(username) {
    return String(username || process.env.BOT_USERNAME || 'hanork_bot')
        .replace(/^@/, '')
        .trim();
}

function getProductBuyLink(productId, username) {
    const user = normalizeUsername(username);
    if (!user) return null;
    if (productId != null && String(productId).trim() !== '') {
        return `https://t.me/${user}?start=buy_${productId}`;
    }
    return `https://t.me/${user}?start=catalogo`;
}

function hasTelegramBuyLink(text) {
    return TG_LINK_RE.test(String(text || ''));
}

/**
 * Garante link t.me no final — nunca postar promo WA/TG sem URL de compra.
 * Trunca o corpo se necessário, mas preserva o CTA + link.
 */
function ensureProductBuyLink(text, productId, username, options = {}) {
    const base = String(text || '').trim();
    const link = options.link || getProductBuyLink(productId, username);
    if (!link) return base;
    if (hasTelegramBuyLink(base)) return base;

    const cta = `\n\n🛒 Comprar agora:\n${link}`;
    const maxLen = options.maxLen || WA_CAPTION_MAX;

    if (!base) return `🛒 Comprar agora:\n${link}`.slice(0, maxLen);

    if (base.length + cta.length <= maxLen) {
        return base + cta;
    }

    const room = maxLen - cta.length - 1;
    const trimmed = room > 20 ? base.slice(0, room).trim() : base.slice(0, Math.max(0, room));
    return `${trimmed}…${cta}`;
}

module.exports = {
    WA_CAPTION_MAX,
    TG_LINK_RE,
    getProductBuyLink,
    hasTelegramBuyLink,
    ensureProductBuyLink,
};
