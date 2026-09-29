'use strict';

const { truncateButtonText } = require('../telegram/telegramButtonText');
const { resolveProductFormat, formatEmoji } = require('./productFormat');

/** Limite visual seguro para botões inline no Telegram (mobile). */
const MAX_LABEL = 28;

function truncateBtn(text, max = MAX_LABEL) {
    return truncateButtonText(text, max);
}

function fmtPrice(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '0,00';
    return n.toFixed(2).replace('.', ',');
}

function fmtPriceTag(value) {
    return `R$ ${fmtPrice(value)}`;
}

function normalizePriceLabel(price) {
    if (price == null || price === '') return '';
    if (typeof price === 'string') {
        const s = price.trim();
        if (s.startsWith('R$')) return s.replace('.', ',');
        return fmtPriceTag(price);
    }
    return fmtPriceTag(price);
}

function buyBtn(price) {
    return truncateBtn(`💳 Comprar ${normalizePriceLabel(price)}`);
}

function featuredViewBtn(price) {
    return truncateBtn(`🛍️ Ver produto · ${normalizePriceLabel(price)}`);
}

function featuredBuyBtn(price) {
    return truncateBtn(`⚡ Comprar ${normalizePriceLabel(price)}`);
}

function flashBuyBtn(price) {
    return truncateBtn(`🔥 Oferta ${normalizePriceLabel(price)}`);
}

function groupBuyBtn(price) {
    const tag = normalizePriceLabel(price);
    return tag ? truncateBtn(`💳 ${tag}`) : '💳 Comprar';
}

function cartBtn(total) {
    return truncateBtn(`🛒 Carrinho ${normalizePriceLabel(total)}`);
}

function restockBtn(subscribed = false) {
    return subscribed ? '🔕 Cancelar aviso' : '🔔 Avisar restock';
}

function payBalanceBtn(total) {
    return truncateBtn(`🤝 Saldo ${normalizePriceLabel(total)}`);
}

function payWalletBtn(total) {
    return truncateBtn(`💳 Carteira ${normalizePriceLabel(total)}`);
}

function catalogProductBtn(product, maxName = 14) {
    const name = String(product?.name || 'Produto').trim();
    const short = name.length > maxName ? `${name.slice(0, maxName - 1)}…` : name;
    const fmt = resolveProductFormat(product);
    const icon = fmt ? formatEmoji(fmt) : '🛍️';
    return truncateBtn(`${icon} ${short} · ${fmtPriceTag(product?.price)}`);
}

module.exports = {
    MAX_LABEL,
    truncateBtn,
    fmtPrice,
    fmtPriceTag,
    normalizePriceLabel,
    buyBtn,
    featuredViewBtn,
    featuredBuyBtn,
    flashBuyBtn,
    groupBuyBtn,
    cartBtn,
    restockBtn,
    payBalanceBtn,
    payWalletBtn,
    catalogProductBtn,
};
