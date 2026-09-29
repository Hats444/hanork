'use strict';

const WaDivulgacaoConfig = require('../waDivulgacaoConfig');
const AdminService = require('../waDivulgacaoAdminService');
const { buildMenuMessage, buildSubsMessage } = require('../handlers/waDivulgacaoAdminPanel');

function registerWaDivulgacaoAdminCommands(bot, { isAdmin, Msg }) {
    if (!WaDivulgacaoConfig.enabled) return;

    bot.command('wadv_stats', async (ctx) => {
        if (!isAdmin?.(ctx.from?.id)) return;
        await Msg.reply(ctx, buildMenuMessage(), null, { parse_mode: 'HTML' });
    });

    bot.command('wadv_subs', async (ctx) => {
        if (!isAdmin?.(ctx.from?.id)) return;
        const panel = buildSubsMessage(0);
        await Msg.reply(ctx, panel.message, panel.keyboard, { parse_mode: 'HTML' });
    });

    bot.command('wadv_plans', async (ctx) => {
        if (!isAdmin?.(ctx.from?.id)) return;
        await ctx.reply('📦 Sincronizando planos Hanork Div…').catch(() => {});
        const r = AdminService.syncPlans();
        await ctx.reply(`✅ Sync OK · ${r.upserted || 0} plano(s) no catálogo.`).catch(() => {});
    });
}

module.exports = { registerWaDivulgacaoAdminCommands };
