'use strict';

const { Markup } = require('telegraf');
const { getPage, summaryBullets, TOTAL } = require('../../../modules/legal/hanorkTerms');
const { CB } = require('../../callbacks/constants');
const { safeAnswerCbQuery } = require('../../../utils/safeTelegram');

function termsKeyboard(pageIndex) {
    const i = Math.max(0, Math.min(TOTAL - 1, pageIndex));
    const nav = [];
    if (i > 0) nav.push({ text: '⬅️ Anterior', callback_data: `terms:page:${i - 1}` });
    if (i < TOTAL - 1) nav.push({ text: '➡️ Próximo', callback_data: `terms:page:${i + 1}` });
    const rows = [];
    if (nav.length) rows.push(nav);
    rows.push([{ text: '🏠 Menu', callback_data: CB.MENU_HOME }]);
    return Markup.inlineKeyboard(rows);
}

function registerTermsHandlers(bot, deps) {
    const { Msg } = deps;

    async function showTerms(ctx, pageIndex = 0) {
        const page = getPage(pageIndex);
        const kb = termsKeyboard(page.index);
        const opts = { screen: 'terms', useMenuPhoto: true };
        return Msg.edit(ctx, page.html, kb, opts);
    }

    bot.action(/^terms:open(?::(\d+))?$/, async (ctx) => {
        await safeAnswerCbQuery(ctx);
        const idx = ctx.match[1] != null ? parseInt(ctx.match[1], 10) : 0;
        return showTerms(ctx, idx);
    });

    bot.action(/^terms:page:(\d+)$/, async (ctx) => {
        await safeAnswerCbQuery(ctx);
        const idx = parseInt(ctx.match[1], 10) || 0;
        return showTerms(ctx, idx);
    });

    bot.action('terms:summary', async (ctx) => {
        await safeAnswerCbQuery(ctx);
        const kb = Markup.inlineKeyboard([
            [{ text: '📖 Ler termos completos', callback_data: 'terms:open:0' }],
            [{ text: '🏠 Menu', callback_data: CB.MENU_HOME }],
        ]);
        return Msg.edit(ctx, summaryBullets(), kb, { screen: 'terms', useMenuPhoto: true });
    });

    return { showTerms, summaryBullets };
}

module.exports = { registerTermsHandlers, termsKeyboard };
