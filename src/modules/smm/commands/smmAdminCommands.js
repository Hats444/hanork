'use strict';

const { isSmmEnabled } = require('../smmEnabled');
const CatalogService = require('../services/catalogService');
const SmmOrderRepository = require('../repositories/smmOrderRepository');
const SmmSyncHistoryRepository = require('../repositories/smmSyncHistoryRepository');
const { runSyncServicesJob } = require('../jobs/syncServicesJob');
const SmmServiceRepository = require('../repositories/smmServiceRepository');
const { formatMoney } = require('../utils/smmTextFormat');
const { countByHealth } = require('../services/serviceHealthService');
const {
    adminBalanceKeyboard,
    getRechargeUrl,
} = require('../services/providerBalanceService');
const {
    fetchUnifiedSupplierSnapshot,
    buildAllSuppliersHtml,
} = require('../../../services/unifiedSupplierBalance');
const SmmConfig = require('../smmConfig');
const ProviderManager = require('../providers/ProviderManager');

function requireSmmAdmin(ctx, isAdmin, Msg) {
    if (!isSmmEnabled()) {
        Msg.reply(ctx, 'ℹ️ Módulo SMM desligado (SMM_ENABLED=0).');
        return false;
    }
    if (!isAdmin(ctx.from?.id)) {
        Msg.reply(ctx, '⛔ Apenas administradores.');
        return false;
    }
    return true;
}

async function replyProviderBalance(ctx, Msg, opts = {}) {
    const snapshot = await fetchUnifiedSupplierSnapshot();
    if (!snapshot.ok) {
        await Msg.reply(ctx, `❌ Erro ao consultar saldos: nenhum fornecedor respondeu.`);
        return null;
    }
    const html = buildAllSuppliersHtml(snapshot.rows, {
        showOkHint: true,
        ...opts,
    });
    const extra = {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        ...adminBalanceKeyboard(),
    };
    await Msg.reply(ctx, html, extra);
    return snapshot;
}

function registerSmmAdminCommands(bot, deps) {
    const { isAdmin, Msg } = deps;

    bot.command('smm_stats', async (ctx) => {
        if (!requireSmmAdmin(ctx, isAdmin, Msg)) return;
        const stats = await CatalogService.stats();
        const orders = SmmOrderRepository.stats();
        const families = SmmServiceRepository.countFamilies(true);
        const health = countByHealth(true);
        const last = SmmSyncHistoryRepository.last();
        const lastLine = last
            ? `\n🔄 Última sync: ${last.finished_at} (${last.total_processed} proc.)`
            : '\n🔄 Nenhuma sincronização registrada.';
        await Msg.reply(
            ctx,
            `📊 <b>SMM — Estatísticas</b>\n\n` +
            `📦 Serviços: <b>${stats.total}</b> (${stats.active} ativos)\n` +
            `🧬 Famílias: <b>${families}</b>\n` +
            `💚 Saúde: <b>${health.HEALTHY || 0}</b> · ⚠️ ${health.WARNING || 0} · ` +
            `🔶 ${health.DEGRADED || 0} · ⛔ ${health.DISABLED || 0}\n` +
            `🛒 Pedidos: <b>${orders.total}</b>\n` +
            `💰 Lucro (concluídos): <b>${formatMoney(orders.profit)}</b>` +
            lastLine,
            { parse_mode: 'HTML' }
        );
    });

    bot.command('smm_balance', async (ctx) => {
        if (!requireSmmAdmin(ctx, isAdmin, Msg)) return;
        await replyProviderBalance(ctx, Msg);
    });

    bot.command('smm_recarregar', async (ctx) => {
        if (!requireSmmAdmin(ctx, isAdmin, Msg)) return;
        const url = getRechargeUrl();
        const extra = {
            parse_mode: 'HTML',
            disable_web_page_preview: true,
            ...adminBalanceKeyboard(),
        };
        await Msg.reply(
            ctx,
            `💳 <b>Recarregar saldo — Hanork SMM</b>\n\n` +
            `A API não permite depósito automático. Use o painel de recarga:\n\n` +
            `1️⃣ Abra o <a href="${url}">painel de recarga</a>\n` +
            `2️⃣ Vá em <b>Adicionar saldo</b> / financeiro\n` +
            `3️⃣ Pague via <b>PIX</b>, cartão ou cripto\n\n` +
            `Limites de alerta no bot:\n` +
            `🟡 &lt; ${formatMoney(SmmConfig.balanceWarnThreshold)} · ` +
            `🔴 &lt; ${formatMoney(SmmConfig.balanceCriticalThreshold)}\n\n` +
            `<i>Após recarregar, toque em «Atualizar saldo».</i>`,
            extra
        );
    });

    bot.action('smm:bal:refresh', async (ctx) => {
        if (!requireSmmAdmin(ctx, isAdmin, Msg)) return;
        await ctx.answerCbQuery('Consultando saldos…');
        const snapshot = await fetchUnifiedSupplierSnapshot();
        if (!snapshot.ok) {
            return Msg.reply(ctx, '❌ Nenhum fornecedor respondeu. Tente de novo em alguns segundos.');
        }
        const html = buildAllSuppliersHtml(snapshot.rows, { showOkHint: true });
        try {
            await ctx.editMessageText(html, {
                parse_mode: 'HTML',
                disable_web_page_preview: true,
                ...adminBalanceKeyboard(),
            });
        } catch (e) {
            await replyProviderBalance(ctx, Msg);
        }
    });

    bot.action('smm:bal:stats', async (ctx) => {
        if (!requireSmmAdmin(ctx, isAdmin, Msg)) return;
        await ctx.answerCbQuery();
        const stats = await CatalogService.stats();
        const orders = SmmOrderRepository.stats();
        await Msg.reply(
            ctx,
            `📊 <b>SMM rápido</b>\n\n` +
            `📦 ${stats.active}/${stats.total} ativos\n` +
            `🛒 ${orders.total} pedidos\n` +
            `💵 Lucro: <b>${formatMoney(orders.profit)}</b>`,
            { parse_mode: 'HTML' }
        );
    });

    bot.command('smm_sync', async (ctx) => {
        if (!requireSmmAdmin(ctx, isAdmin, Msg)) return;
        await Msg.reply(ctx, '🔄 Sincronizando catálogo SMM…');
        const result = await runSyncServicesJob({ source: 'auto', syncType: 'manual_admin' });
        await Msg.reply(
            ctx,
            result.ok
                ? `✅ Sync OK\n` +
                `Processados: ${result.total_processed}\n` +
                `Criados: ${result.created_count}\n` +
                `Atualizados: ${result.updated_count}\n` +
                `Removidos: ${result.removed_count}\n` +
                `Famílias ativas: ${result.families_active ?? '—'}`
                : `❌ Falhou: ${result.error}`,
            { parse_mode: 'HTML' }
        );
    });

    bot.command('smm_services', async (ctx) => {
        if (!requireSmmAdmin(ctx, isAdmin, Msg)) return;
        const stats = await CatalogService.stats();
        const platforms = await CatalogService.getPlatforms();
        const top = platforms.slice(0, 8).map((p) => `· ${p.platform}: ${p.total}`).join('\n');
        await Msg.reply(
            ctx,
            `📦 <b>Serviços SMM</b>\n\nTotal: <b>${stats.total}</b>\nAtivos: <b>${stats.active}</b>\n\n${top}`,
            { parse_mode: 'HTML' }
        );
    });

    bot.command('smm_orders', async (ctx) => {
        if (!requireSmmAdmin(ctx, isAdmin, Msg)) return;
        const orders = SmmOrderRepository.stats();
        await Msg.reply(
            ctx,
            `🛒 <b>Pedidos SMM</b>\n\nTotal: <b>${orders.total}</b>`,
            { parse_mode: 'HTML' }
        );
    });

    bot.command('smm_profit', async (ctx) => {
        if (!requireSmmAdmin(ctx, isAdmin, Msg)) return;
        const orders = SmmOrderRepository.stats();
        await Msg.reply(
            ctx,
            `💵 <b>Lucro SMM</b> (pedidos concluídos)\n\n<b>${formatMoney(orders.profit)}</b>`,
            { parse_mode: 'HTML' }
        );
    });

    bot.command('provider', async (ctx) => {
        if (!requireSmmAdmin(ctx, isAdmin, Msg)) return;
        const arg = String(ctx.message?.text || '').trim().split(/\s+/)[1] || '';
        if (!arg) {
            const mode = ProviderManager.getEffectiveMode();
            const admin = ProviderManager.getAdminMode();
            const chain = ProviderManager.getProviderChain().join(' → ');
            await Msg.reply(
                ctx,
                `🔌 <b>Modo provedor SMM</b>\n\n` +
                `Ativo: <b>${mode}</b>${admin ? ` (admin: ${admin})` : ''}\n` +
                `Cadeia: <code>${chain}</code>\n` +
                `Dual: ${ProviderManager.isDualProviderEnabled() ? 'sim' : 'não'}\n\n` +
                `Uso: <code>/provider auto</code> · <code>/provider ssm</code> · <code>/provider up</code>`,
                { parse_mode: 'HTML' }
            );
            return;
        }
        const next = ProviderManager.setAdminMode(arg);
        if (!next) {
            await Msg.reply(ctx, '❌ Modo inválido. Use: auto, ssm ou up.');
            return;
        }
        await Msg.reply(
            ctx,
            `✅ Modo admin: <b>${next}</b>\nCadeia: <code>${ProviderManager.getProviderChain().join(' → ')}</code>`,
            { parse_mode: 'HTML' }
        );
    });

    bot.command('smm_provider_cache', async (ctx) => {
        if (!requireSmmAdmin(ctx, isAdmin, Msg)) return;
        await Msg.reply(ctx, '🔄 Atualizando cache de serviços dos provedores…');
        const counts = await ProviderManager.refreshServicesCache();
        const lines = Object.entries(counts).map(([id, n]) => `· ${id}: ${n} serviços`);
        await Msg.reply(
            ctx,
            `✅ Cache atualizado\n\n${lines.join('\n') || '—'}`,
            { parse_mode: 'HTML' }
        );
    });

    bot.command('smm_map_sync', async (ctx) => {
        if (!requireSmmAdmin(ctx, isAdmin, Msg)) return;
        await Msg.reply(ctx, '🔄 Sync FornecedorBrasil + UP FAMA → SQLite + mapping…');
        try {
            const { runFullSync } = require('../../../../scripts/sync-smm-service-mapping');
            const { payload } = await runFullSync({ minScore: 0.52, output: SmmConfig.serviceMappingPath });
            ProviderManager._clearTestMapping?.();

            const fb = payload.catalogSync?.fornecedorbrasil;
            const up = payload.catalogSync?.upfama;
            const fbLine = fb
                ? `📦 FB: ${fb.processed} proc · ${fb.created}+${fb.updated} alt · ${fb.removed} off`
                : '📦 FB: —';
            const upLine = up
                ? `📦 UP: ${up.processed} proc · ${up.created}+${up.updated} alt · ${up.removed} off`
                : '📦 UP: —';

            await Msg.reply(
                ctx,
                `✅ <b>Sync SMM completo</b>\n\n` +
                `${fbLine}\n${upLine}\n` +
                `🔗 Mapping: <b>${payload.stats.mapped}</b> pares\n` +
                `📊 API: SSM ${payload.stats.ssmTotal} · UP ${payload.stats.upTotal}\n\n` +
                `<i>Catálogo + preços + fallback sempre atuais.</i>`,
                { parse_mode: 'HTML' }
            );
        } catch (e) {
            await Msg.reply(ctx, `❌ Falhou: ${String(e.message).slice(0, 200)}`);
        }
    });
}

module.exports = { registerSmmAdminCommands };
