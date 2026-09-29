'use strict';

const { HANORK_PRODUCT_ID } = require('../constants/hanorkProduct');

function botUsername(username) {
    return String(username || process.env.BOT_USERNAME || 'hanork_bot').replace(/^@/, '');
}

function buyDeepLink(username, productId = HANORK_PRODUCT_ID) {
    return `https://t.me/${botUsername(username)}?start=buy_${productId}`;
}

function catalogDeepLink(username) {
    return `https://t.me/${botUsername(username)}?start=comprar`;
}

function smmDeepLink(username) {
    return `https://t.me/${botUsername(username)}?start=smm`;
}

function virtuoDeepLink(username) {
    return `https://t.me/${botUsername(username)}?start=sms`;
}

function hanorkDivDeepLink(username) {
    return `https://t.me/${botUsername(username)}?start=handiv`;
}

/** Extrai payload ?start= de link t.me/telegram.me do próprio bot. */
function parseBotStartDeepLink(input) {
    const raw = String(input || '').trim();
    const match = raw.match(/https?:\/\/(?:t\.me|telegram\.me)\/[^\s]+/i);
    if (!match) return null;
    const url = match[0].replace(/[.,;)]+$/, '');
    if (raw.replace(url, '').trim() && !/^[\s.,!?]+$/.test(raw.replace(url, ''))) return null;
    try {
        const parsed = new URL(url);
        const host = parsed.hostname.toLowerCase();
        if (host !== 't.me' && host !== 'telegram.me') return null;
        const start = parsed.searchParams.get('start');
        return start ? String(start).trim() : null;
    } catch {
        return null;
    }
}

function appendDeepLinkCta(html, link, label) {
    const body = String(html || '').trim();
    if (!body) return `<a href="${link}">${label}</a>`;
    if (body.includes('t.me/') || body.includes('href=')) return body;
    return `${body}\n\n<a href="${link}">${label}</a>`;
}

function appendHanorkCta(html, opts = {}) {
    const link = opts.botLink || buyDeepLink(opts.username, opts.productId);
    const label = opts.ctaLabel || '🛒 Comprar agora';
    return appendDeepLinkCta(html, link, label);
}

function appendSmmCta(html, opts = {}) {
    const link = opts.botLink || smmDeepLink(opts.username);
    const label = opts.ctaLabel || '📈 Ver serviços SMM';
    return appendDeepLinkCta(html, link, label);
}

function appendVirtuoCta(html, opts = {}) {
    const link = opts.botLink || virtuoDeepLink(opts.username);
    const label = opts.ctaLabel || '📱 Comprar número SMS';
    return appendDeepLinkCta(html, link, label);
}

module.exports = {
    HANORK_PRODUCT_ID,
    botUsername,
    buyDeepLink,
    catalogDeepLink,
    smmDeepLink,
    virtuoDeepLink,
    hanorkDivDeepLink,
    parseBotStartDeepLink,
    appendHanorkCta,
    appendSmmCta,
    appendVirtuoCta,
    appendDeepLinkCta,
};
