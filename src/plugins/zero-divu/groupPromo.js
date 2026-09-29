'use strict';

/**
 * Divulgação em grupos — não depende de ler mensagens do chat.
 * Teclados só com URL (callbacks não funcionam bem em grupo para quem não abriu o bot).
 */
const { Markup } = require('telegraf');
const { groupBuyBtn } = require('../utils/buttonLabels');

function buildGroupPromoKeyboard(botUsername, opts = {}) {
    const user = (botUsername || process.env.BOT_USERNAME || '').replace('@', '');
    const rows = [];
    const base = user ? `https://t.me/${user}` : null;

    if (opts.buyProductId && base) {
        rows.push([{ text: opts.buyLabel || groupBuyBtn(), url: `${base}?start=buy_${opts.buyProductId}` }]);
    }
    if (base) {
        rows.push([{ text: opts.openBotLabel || '🛍️ Abrir catálogo', url: `${base}?start=comprar` }]);
    }
    return Markup.inlineKeyboard(rows.length ? rows : [[{ text: '🛍️ Catálogo', url: base || 'https://t.me' }]]);
}

/** Teclado SMM — link direto para catálogo de serviços */
function buildSmmBroadcastGroupKeyboard(botUsername) {
    const user = (botUsername || process.env.BOT_USERNAME || '').replace('@', '');
    const base = user ? `https://t.me/${user}` : 'https://t.me/hanork_bot';
    return Markup.inlineKeyboard([
        [{ text: '📈 Serviços SMM', url: `${base}?start=smm` }],
        [{ text: '🛍️ Abrir catálogo', url: `${base}?start=comprar` }],
    ]);
}

/** Teclado de produto automático — só links para grupos */
function buildAutoBroadcastGroupKeyboard(botUsername, productId, priceLabel) {
    return buildGroupPromoKeyboard(botUsername, {
        buyProductId: productId,
        buyLabel: groupBuyBtn(priceLabel),
    });
}

/** Converte reply_markup Telegraf → botões GramJS (URL only, para ponte MTProto). */
function gramJsButtonsFromReplyMarkup(replyMarkup) {
    try {
        const { Button } = require('telegram/tl/custom/button');
        const kb =
            replyMarkup?.reply_markup?.inline_keyboard ?? replyMarkup?.inline_keyboard ?? null;
        if (!kb?.length) return undefined;
        const rows = [];
        for (const row of kb) {
            const out = [];
            for (const btn of row) {
                if (btn.url && btn.text) {
                    out.push(Button.url(btn.text, btn.url));
                }
            }
            if (out.length) rows.push(out);
        }
        return rows.length ? rows : undefined;
    } catch {
        return undefined;
    }
}

module.exports = {
    buildGroupPromoKeyboard,
    buildAutoBroadcastGroupKeyboard,
    buildSmmBroadcastGroupKeyboard,
    gramJsButtonsFromReplyMarkup,
};
