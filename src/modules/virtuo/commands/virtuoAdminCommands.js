'use strict';

const { runSyncCatalogJob } = require('../jobs/syncCatalogJob');
const VirtuoOrderRepository = require('../repositories/virtuoOrderRepository');
const VirtuoBalanceService = require('../services/virtuoBalanceService');
const VirtuoConfig = require('../virtuoConfig');
const VirtuoFulfillmentService = require('../services/fulfillmentService');
const { processAutomaticRefund } = require('../services/virtuoFailureRecoveryService');
const { formatMoney } = require('../utils/virtuoTextFormat');
const { getDocsPage, docsKeyboard, buildDocsIntroHtml } = require('../utils/virtuoApiDocs');
const {
    fetchUnifiedSupplierSnapshot,
    buildAllSuppliersHtml,
} = require('../../../services/unifiedSupplierBalance');

async function sendVirtuoDocsPage(ctx, Msg, pageIndex = 0) {
    const page = getDocsPage(pageIndex);
    const text = `${buildDocsIntroHtml()}\n\n${page.html}`.slice(0, 4096);
    return Msg.reply(ctx, text, docsKeyboard(page.index, page.total), {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
    });
}

async function replyVirtuoBalance(ctx, Msg) {
    const snapshot = await fetchUnifiedSupplierSnapshot();
    if (!snapshot.ok) {
        return Msg.reply(ctx, '❌ Nenhum fornecedor respondeu. Tente de novo em alguns segundos.');
    }
    const html = buildAllSuppliersHtml(snapshot.rows, { showOkHint: true });
    const extra = {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        ...VirtuoBalanceService.adminBalanceKeyboard(),
    };
    return Msg.reply(ctx, html, extra);
}

function resolveVirtuoOrderByArg(arg) {
    const needle = String(arg || '').replace(/^#/, '').trim().toLowerCase();
    if (!needle) return null;
    const rows = VirtuoOrderRepository.listByStatus(
        ['awaiting_payment', 'paid', 'waiting_sms', 'completed', 'failed', 'cancelled'],
        200
    );
    return (
        rows.find((r) => String(r.hanork_order_id || '').toLowerCase() === needle) ||
        rows.find((r) => String(r.hanork_order_id || '').toLowerCase().endsWith(needle)) ||
        rows.find((r) => String(r.id) === needle) ||
        null
    );
}

function registerVirtuoAdminCommands(bot, { isAdmin, Msg }) {
    bot.command('virtuo_sync', async (ctx) => {
        if (!isAdmin?.(ctx.from?.id)) return;
        await ctx.reply('🔄 Sincronizando catálogo Virtuo…').catch(() => {});
        const result = await runSyncCatalogJob();
        const text = result.ok
            ? `✅ Sync OK · ${result.upserted} ofertas · ${result.activeKeys} chaves`
            : `❌ Sync falhou: ${result.error || 'erro'}`;
        await ctx.reply(text).catch(() => {});
    });

    bot.command('virtuo_balance', async (ctx) => {
        if (!isAdmin?.(ctx.from?.id)) return;
        await replyVirtuoBalance(ctx, Msg);
    });

    bot.command('virtuo_recarregar', async (ctx) => {
        if (!isAdmin?.(ctx.from?.id)) return;
        const url = VirtuoConfig.rechargeUrl;
        await Msg.reply(
            ctx,
            `💳 <b>Recarregar saldo — Virtuo SMS</b>\n\n` +
                `Use o painel Virtuo para adicionar créditos:\n\n` +
                `🔗 <a href="${url}">Abrir painel Virtuo</a>\n\n` +
                `Limites de alerta no bot:\n` +
                `🟡 &lt; ${formatMoney(VirtuoConfig.balanceWarn)} · ` +
                `🔴 &lt; ${formatMoney(VirtuoConfig.balanceCritical)}\n\n` +
                `<i>Após recarregar, toque em «Atualizar saldo» ou use /virtuo_balance.</i>`,
            {
                parse_mode: 'HTML',
                disable_web_page_preview: true,
                ...VirtuoBalanceService.adminBalanceKeyboard(),
            }
        );
    });

    bot.command('virtuo_orders', async (ctx) => {
        if (!isAdmin?.(ctx.from?.id)) return;
        const rows = VirtuoOrderRepository.listByStatus(
            ['awaiting_payment', 'paid', 'waiting_sms', 'completed', 'failed', 'cancelled'],
            12
        );
        if (!rows.length) {
            return ctx.reply('Nenhum pedido Virtuo.').catch(() => {});
        }
        const lines = rows.map((r) => {
            const ref = r.hanork_order_id ? `#${String(r.hanork_order_id).slice(-8)}` : `v${r.id}`;
            return `• ${ref} · ${r.service_name} (${r.country_name}) · ${String(r.status).toUpperCase()}`;
        });
        await Msg.reply(
            ctx,
            `<b>📱 Pedidos Virtuo (recentes)</b>\n\n${lines.join('\n')}\n\n` +
                `<i>/virtuo_retry &lt;id&gt; · /virtuo_refund &lt;id&gt; · /virtuo_docs</i>`,
            { parse_mode: 'HTML' }
        );
    });

    bot.command('virtuo_retry', async (ctx) => {
        if (!isAdmin?.(ctx.from?.id)) return;
        const arg = (ctx.message?.text || '').split(/\s+/)[1];
        if (!arg) {
            return ctx.reply('Uso: /virtuo_retry <order_id ou #final>').catch(() => {});
        }
        const vo = resolveVirtuoOrderByArg(arg);
        if (!vo?.hanork_order_id) {
            return ctx.reply('Pedido Virtuo não encontrado.').catch(() => {});
        }
        await ctx.reply(`🔄 Reprocessando ${vo.hanork_order_id.slice(-8)}…`).catch(() => {});
        const botInst = global.botInstance;
        const r = await VirtuoFulfillmentService.fulfillHanorkOrder(vo.hanork_order_id, botInst, {
            forceRetry: true,
        });
        await ctx.reply(JSON.stringify(r, null, 2).slice(0, 3500)).catch(() => {});
    });

    bot.command('virtuo_docs', async (ctx) => {
        if (!isAdmin?.(ctx.from?.id)) return;
        await sendVirtuoDocsPage(ctx, Msg, 0);
    });

    bot.command('virtuo_refund', async (ctx) => {
        if (!isAdmin?.(ctx.from?.id)) return;
        const arg = (ctx.message?.text || '').split(/\s+/)[1];
        if (!arg) {
            return ctx.reply('Uso: /virtuo_refund <order_id ou #final> [motivo]').catch(() => {});
        }
        const vo = resolveVirtuoOrderByArg(arg);
        if (!vo?.hanork_order_id) {
            return ctx.reply('Pedido Virtuo não encontrado.').catch(() => {});
        }
        const reason = (ctx.message?.text || '').split(/\s+/)[2] || 'out_of_stock';
        await ctx.reply(`♻️ Reembolsando ${vo.hanork_order_id.slice(-8)}…`).catch(() => {});
        const r = await processAutomaticRefund(vo.hanork_order_id, reason);
        await ctx.reply(JSON.stringify(r, null, 2).slice(0, 3500)).catch(() => {});
    });
}

module.exports = { registerVirtuoAdminCommands, sendVirtuoDocsPage };
