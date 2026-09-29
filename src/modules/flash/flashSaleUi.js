'use strict';

const { Markup } = require('telegraf');
const Msg = require('../../telegram/Msg');
const { flashBuyBtn } = require('../../utils/buttonLabels');

function formatTimer(ms) {
    if (ms <= 0) return '⏰ Expirando...';
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    if (h > 0) return `${h}h ${m < 10 ? '0' : ''}${m}min`;
    if (m > 0) return `${m}min ${s < 10 ? '0' : ''}${s}s`;
    return `${s}s`;
}

function discountBar(pct) {
    const filled = Math.round(pct / 10);
    return '🟥'.repeat(filled) + '⬜'.repeat(10 - filled);
}

function buildSaleCard(s, idx, total) {
    const ms = new Date(s.ends_at) - Date.now();
    const pct = Math.round((s.original_price - s.sale_price) / s.original_price * 100);
    const timer = formatTimer(ms);
    const bar = discountBar(pct);
    const economia = (s.original_price - s.sale_price).toFixed(2);
    const stockInfo = s.stock_limit > 0
        ? `\n📊 <b>${s.sold_count}/${s.stock_limit}</b> unidades vendidas`
        : '';
    let stockBar = '';
    if (s.stock_limit > 0) {
        const soldPct = Math.min(s.sold_count / s.stock_limit, 1);
        const filledStock = Math.round(soldPct * 10);
        stockBar = `\n${'🟥'.repeat(filledStock)}${'⬜'.repeat(10 - filledStock)} ${Math.round(soldPct * 100)}% vendido`;
    }
    return (
        `🔥 <b>OFERTA ${idx}/${total} — RELÂMPAGO</b>\n` +
        `━━━━━━━━━━━━━━━━━\n` +
        `📦 <b>${s.product_name}</b>\n\n` +
        `💸 <s>R$ ${s.original_price.toFixed(2)}</s> ➜ <b>R$ ${s.sale_price.toFixed(2)}</b>\n` +
        `${bar} <b>-${pct}%</b>\n` +
        `✅ Você economiza <b>R$ ${economia}</b>\n` +
        `⏳ Termina em: <b>${timer}</b>` +
        stockInfo +
        stockBar
    );
}

function buildSaleKeyboard(s, sales, idx, { groupGuard, getBotUsername, ctx } = {}) {
    const total = sales.length;
    const rows = [];
    const buyCb = `fs_buy_${s.product_id}_${s.id}`;

    if (groupGuard?.isGroupChat?.(ctx)) {
        rows.push([{ text: flashBuyBtn(s.sale_price), url: groupGuard.privateUrl(getBotUsername, `buy_${s.product_id}`) }]);
    } else {
        rows.push([{ text: flashBuyBtn(s.sale_price), callback_data: buyCb }]);
    }
    rows.push([{ text: '📦 Ver Produto', callback_data: `p_${s.product_id}` }]);
    if (total > 1) {
        const navRow = [];
        if (idx > 0) navRow.push({ text: `◀️ ${idx}/${total}`, callback_data: `fs_nav_${idx - 1}` });
        else navRow.push({ text: `• ${idx + 1}/${total}`, callback_data: 'noop' });
        if (idx < total - 1) navRow.push({ text: `${idx + 2}/${total} ▶️`, callback_data: `fs_nav_${idx + 1}` });
        rows.push(navRow);
    }
    rows.push([{ text: '🛍️ Catálogo', callback_data: 'cat' }, { text: '🏠 Menu', callback_data: 'home' }]);
    return Markup.inlineKeyboard(rows);
}

async function renderFlashSaleAtIndex(ctx, sales, idx, { groupGuard, getBotUsername } = {}) {
    const safeIdx = Math.max(0, Math.min(idx, sales.length - 1));
    const s = sales[safeIdx];
    const txt = buildSaleCard(s, safeIdx + 1, sales.length);
    const uname = typeof getBotUsername === 'function' ? await getBotUsername(ctx) : '';
    const kb = buildSaleKeyboard(s, sales, safeIdx, { groupGuard, getBotUsername: uname, ctx });
    if (s.product_photo) {
        await Msg.replaceMenu(ctx, txt, kb, { photoUrl: s.product_photo });
    } else {
        await Msg.editCallbackPanel(ctx, txt, kb);
    }
}

module.exports = {
    formatTimer,
    discountBar,
    buildSaleCard,
    buildSaleKeyboard,
    renderFlashSaleAtIndex,
};
