'use strict';

const { denySilent } = require('../../../utils/silencedAccess');

const { conversionAnalytics } = require('../../../services/ConversionAnalyticsService');
const { maskTelegramId } = require('../../../utils/maskSensitiveData');
const { kb2 } = require('../../menus/twoColKeyboard');

function fmtMoney(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return 'R$ 0,00';
    return `R$ ${v.toFixed(2).replace('.', ',')}`;
}

function formatSummaryText(summary) {
    const lines = [
        '📊 <b>Análise de conversão</b>',
        '',
        `👥 Usuários totais: <b>${summary.totalUsers}</b>`,
        `🟢 Ativos (${summary.days}d): <b>${summary.activeUsers}</b>`,
        `💳 Pagantes: <b>${summary.payers}</b>`,
        `📈 Conversão: <b>${summary.conversionPct}%</b>`,
        '',
        `💰 Receita total: <b>${fmtMoney(summary.revenueTotal)}</b>`,
        `📅 Receita ${summary.days}d: <b>${fmtMoney(summary.revenue30d)}</b>`,
    ];
    if (summary.topProducts?.length) {
        lines.push('', '🏆 <b>Top produtos</b>');
        summary.topProducts.forEach((p, i) => {
            lines.push(`${i + 1}. ${p.name || 'Produto'} — ${p.qty} un · ${fmtMoney(p.revenue)}`);
        });
    }
    if (summary.bottomProducts?.length) {
        lines.push('', '📉 <b>Menos vendidos</b>');
        summary.bottomProducts.forEach((p, i) => {
            lines.push(`${i + 1}. ${p.name || 'Produto'} — ${p.qty} un · ${fmtMoney(p.revenue)}`);
        });
    }
    if (summary.topCommands?.length) {
        lines.push('', '⌨️ <b>Comandos mais usados</b>');
        summary.topCommands.forEach((c, i) => {
            lines.push(`${i + 1}. ${c.cmd || '/?'} — ${c.uses}x`);
        });
    }
    return lines.join('\n');
}

function formatFunnelText(funnel) {
    const lines = [
        '📉 <b>Funil de conversão</b>',
        `<i>Últimos ${funnel.days} dias</i>`,
        '',
    ];
    funnel.stages.forEach((st, i) => {
        const arrow = i > 0 && st.dropFromPrev > 0 ? ` ↓${st.dropFromPrev}%` : '';
        lines.push(`${st.stage}: <b>${st.count}</b> (${st.pctOfTotal}%${arrow})`);
    });
    lines.push('', `🎯 Conversão final: <b>${funnel.conversionFinalPct}%</b>`);
    return lines.join('\n');
}

function formatLostUsersPreview(lost) {
    const mask = (u) => maskTelegramId(u.telegram_id);
    const c = lost.counts || {};
    const lines = [
        '🔍 <b>Usuários perdidos</b>',
        '',
        `Sem compra: <b>${c.noPurchase ?? 0}</b>`,
        ...(lost.noPurchase || []).slice(0, 3).map((u) => ` · ${mask(u)}`),
        '',
        `Carrinho abandonado: <b>${c.abandonedCart ?? 0}</b>`,
        ...(lost.abandonedCart || []).slice(0, 3).map((u) => ` · ${mask(u)}`),
        '',
        `Pagamento não concluído: <b>${c.pixUnpaid ?? 0}</b>`,
        ...(lost.pixUnpaid || []).slice(0, 3).map((u) => ` · ${mask(u)}`),
        '',
        `Inativos 30d+: <b>${c.inactive30 ?? 0}</b>`,
        ...(lost.inactive30 || []).slice(0, 3).map((u) => ` · ${mask(u)}`),
        '',
        '<i>IDs mascarados · sem envio automático.</i>',
    ];
    return lines.join('\n');
}

function analyticsKeyboard(Markup) {
    return kb2(Markup, [
        [
            { text: '🔄 Atualizar', callback_data: 'a_analytics' },
            { text: '📉 Funil', callback_data: 'a_analytics_funil' },
        ],
        [
            { text: '📊 Stats', callback_data: 'a_stats' },
            { text: '🔙 Admin', callback_data: 'a_menu' },
        ],
    ]);
}

function funnelKeyboard(Markup) {
    return kb2(Markup, [
        [
            { text: '🔄 Atualizar', callback_data: 'a_analytics_funil' },
            { text: '📈 Conversão', callback_data: 'a_analytics' },
        ],
        [{ text: '🔙 Admin', callback_data: 'a_menu' }],
    ]);
}

async function showAnalyticsSummary(ctx, deps) {
    const { editAdminPanel, Msg, Markup, logger } = deps;
    const summary = conversionAnalytics.getSummary();
    const text = formatSummaryText(summary);
    const kb = analyticsKeyboard(Markup);
    if (ctx.callbackQuery && editAdminPanel) {
        await editAdminPanel(ctx, text, kb);
    } else {
        await Msg.reply(ctx, text, kb, { parse_mode: 'HTML' });
    }
}

async function showAnalyticsFunnel(ctx, deps) {
    const { editAdminPanel, Msg, Markup, logger } = deps;
    const funnel = conversionAnalytics.getFunnel();
    const lost = conversionAnalytics.getLostUsers(null, 20);
    const text = `${formatFunnelText(funnel)}\n\n${formatLostUsersPreview(lost)}`;
    const kb = funnelKeyboard(Markup);
    if (ctx.callbackQuery && editAdminPanel) {
        await editAdminPanel(ctx, text, kb);
    } else {
        await Msg.reply(ctx, text, kb, { parse_mode: 'HTML' });
    }
}

function registerAnalyticsHandlers(bot, deps) {
    const { isAdmin, Msg, logger } = deps;

    bot.command('analytics', async (ctx) => {
        if (!isAdmin(ctx.from?.id)) { denySilent('admin', ctx); return; }
        try {
            await showAnalyticsSummary(ctx, deps);
        } catch (e) {
            logger.error('[ANALYTICS] /analytics:', e.message);
            await Msg.reply(ctx, '❌ Erro ao carregar analytics.');
        }
    });

    bot.command('analytics_funil', async (ctx) => {
        if (!isAdmin(ctx.from?.id)) { denySilent('admin', ctx); return; }
        try {
            await showAnalyticsFunnel(ctx, deps);
        } catch (e) {
            logger.error('[ANALYTICS] /analytics_funil:', e.message);
            await Msg.reply(ctx, '❌ Erro ao carregar funil.');
        }
    });

    bot.action('a_analytics', async (ctx) => {
        if (!isAdmin(ctx.from?.id)) { denySilent('admin_callback', ctx); return; }
        await ctx.answerCbQuery('📈 Conversão…');
        try {
            await showAnalyticsSummary(ctx, deps);
        } catch (e) {
            logger.error('[ANALYTICS] a_analytics:', e.message);
            await Msg.reply(ctx, '❌ Erro ao carregar analytics.');
        }
    });

    bot.action('a_analytics_funil', async (ctx) => {
        if (!isAdmin(ctx.from?.id)) { denySilent('admin_callback', ctx); return; }
        await ctx.answerCbQuery('📉 Funil…');
        try {
            await showAnalyticsFunnel(ctx, deps);
        } catch (e) {
            logger.error('[ANALYTICS] a_analytics_funil:', e.message);
            await Msg.reply(ctx, '❌ Erro ao carregar funil.');
        }
    });
}

module.exports = { registerAnalyticsHandlers };
