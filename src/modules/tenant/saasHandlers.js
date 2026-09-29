'use strict';

const { denyCbSilent } = require('../../utils/silencedAccess');

const { Markup } = require('telegraf');
const Msg = require('../../telegram/Msg');
const TenantService = require('./TenantService');
const tenantSession = require('./tenantSession');
const TenantLimits = require('./TenantLimits');
const PaymentService = require('../payment/PaymentService');
const tenantContext = require('../../infrastructure/TenantContext');
const { isPlatformAdmin } = require('./tenantScope');
const logger = require('../../config/logger');

function siteBase() {
    return (process.env.SITE_HANORK || '').replace(/\/$/, '');
}

async function showTenantPanel(ctx, deps) {
    const { stateManager, isAdmin: isBotAdmin } = deps;
    const lojas = TenantService.getByOwner(String(ctx.from.id));
        if (!lojas.length) {
            return Msg.reply(ctx, '🏪 Você ainda não tem lojas.\n\nUse /registrar_loja para criar a primeira.');
        }
        if (lojas.length === 1) {
            await tenantSession.setActiveTenantId(String(ctx.from.id), lojas[0].id, stateManager);
        }
        const activeId = (await tenantSession.getActiveTenantId(String(ctx.from.id), stateManager)) || lojas[0].id;
        const t = TenantService.getById(activeId) || lojas[0];
        const plan = TenantService.getPlan(t.plan);
        const stats = TenantService.getStats(t.id);
        const prod = TenantService.checkProductLimit(t.id);
        const ord = TenantService.checkOrderLimit(t.id);
        const vitrine = siteBase() ? `${siteBase()}/loja/${t.slug}` : `/loja/${t.slug}`;

        const text =
            `🏪 <b>${t.name}</b>\n` +
            `<code>${t.slug}</code> · Plano <b>${plan?.label || t.plan}</b>\n\n` +
            `📊 <b>Hoje:</b> R$ ${Number(stats.revenue_today).toFixed(2)}\n` +
            `📅 <b>Mês:</b> R$ ${Number(stats.revenue_month).toFixed(2)} (${stats.orders_month} pedidos)\n` +
            `👥 Clientes: ${stats.users_total}\n` +
            `🛍️ Produtos: ${prod.current}/${prod.max >= 999 ? '∞' : prod.max}\n` +
            `📦 Pedidos/mês: ${ord.current}/${ord.max >= 9999 ? '∞' : ord.max}\n\n` +
            `🔗 Vitrine: <code>${vitrine}</code>\n` +
            `💳 MP: ${t.token_mp ? '✅' : '⚠️ use onboarding ou painel'}\n\n` +
            `<i>Comandos da loja usam esta loja ativa.</i>`;

        const rows = [
            [{ text: '🛍️ Produtos', callback_data: 'saas_prods' }, { text: '📊 Stats', callback_data: 'saas_stats' }],
            [{ text: '📦 Planos', callback_data: 'saas_planos' }, { text: '🔗 Vitrine', callback_data: 'saas_vitrine' }],
        ];
        if (lojas.length > 1) {
            rows.push([{ text: '🔄 Trocar loja', callback_data: 'saas_switch' }]);
        }
        if (isBotAdmin(ctx.from.id)) {
            rows.push([{ text: '⚡ Admin global', callback_data: 'a_menu' }]);
        }
        rows.push([{ text: '🏠 Menu', callback_data: 'menu:home' }]);

    if (ctx.callbackQuery) {
        await Msg.editCallbackPanel(ctx, text, Markup.inlineKeyboard(rows));
    } else {
        await Msg.reply(ctx, text, Markup.inlineKeyboard(rows));
    }
}

function registerSaasHandlers(bot, deps) {
    const { stateManager, isAdmin: isBotAdmin } = deps;

    bot.command('admin_loja', async (ctx) => showTenantPanel(ctx, deps));

    bot.action('saas_stats', async (ctx) => {
        await ctx.answerCbQuery();
        const tid = await tenantSession.getActiveTenantId(String(ctx.from.id), stateManager);
        if (!tid) {
            return Msg.editCallbackPanel(ctx, '❌ Nenhuma loja ativa.', Markup.inlineKeyboard([[{ text: '🔙', callback_data: 'saas_back' }]]));
        }
        const s = TenantService.getStats(tid);
        await Msg.editCallbackPanel(
            ctx,
            `📊 <b>Estatísticas</b>\n\nHoje: R$ ${Number(s.revenue_today).toFixed(2)}\nMês: R$ ${Number(s.revenue_month).toFixed(2)}\nPedidos: ${s.orders_month}\nClientes: ${s.users_total}`,
            Markup.inlineKeyboard([[{ text: '🔙 Painel loja', callback_data: 'saas_back' }]])
        );
    });

    bot.action('saas_prods', async (ctx) => {
        await ctx.answerCbQuery();
        await Msg.editCallbackPanel(
            ctx,
            '🛍️ <b>Produtos da sua loja</b>\n\nUse:\n• /gerenciarprodutos\n• /addproduto',
            Markup.inlineKeyboard([[{ text: '🔙 Painel loja', callback_data: 'saas_back' }]])
        );
    });

    bot.action('saas_vitrine', async (ctx) => {
        await ctx.answerCbQuery();
        const tid = await tenantSession.getActiveTenantId(String(ctx.from.id), stateManager);
        const t = TenantService.getById(tid);
        if (!t) return;
        const url = siteBase() ? `${siteBase()}/loja/${t.slug}` : `/loja/${t.slug}`;
        await Msg.editCallbackPanel(
            ctx,
            `🔗 <b>Vitrine pública</b>\n\n<code>${url}</code>\n\nCompartilhe este link ou use deep link:\n<code>https://t.me/${process.env.BOT_USERNAME || 'bot'}?start=loja_${t.slug}</code>`,
            Markup.inlineKeyboard([[{ text: '🔙 Painel loja', callback_data: 'saas_back' }]])
        );
    });

    bot.action('saas_planos', async (ctx) => {
        await ctx.answerCbQuery();
        const plans = TenantService.getPlans().filter((p) => p.price > 0);
        const rows = plans.map((p) => [
            { text: `${p.label} — R$ ${p.price.toFixed(2)}`, callback_data: `saas_upg_${p.name}` },
        ]);
        rows.push([{ text: '🔙 Painel loja', callback_data: 'saas_back' }]);
        await Msg.editCallbackPanel(ctx, '📦 <b>Upgrade de plano</b>\n\nEscolha um plano (PIX):', Markup.inlineKeyboard(rows));
    });

    bot.action(/^saas_upg_(.+)$/, async (ctx) => {
        const planName = ctx.match[1];
        await ctx.answerCbQuery();
        const tid = await tenantSession.getActiveTenantId(String(ctx.from.id), stateManager);
        const tenant = TenantService.getById(tid);
        const plan = TenantService.getPlan(planName);
        if (!tenant || !plan) return;

        if (!PaymentService.isAvailable(tenant)) {
            return Msg.editCallbackPanel(
                ctx,
                '❌ Configure o token Mercado Pago da loja (onboarding) ou TOKEN_MP global.',
                Markup.inlineKeyboard([[{ text: '🔙', callback_data: 'saas_planos' }]])
            );
        }

        const ref = `plan_${tenant.id}_${planName}`;
        try {
            const pix = await PaymentService.createPix(
                plan.price,
                `Plano ${plan.label} — ${tenant.name}`,
                ref,
                tenant.mp_payer_email,
                tenant
            );
            await Msg.editCallbackPanel(
                ctx,
                `💳 <b>PIX — Plano ${plan.label}</b>\n\n` +
                    `Valor: <b>R$ ${plan.price.toFixed(2)}</b>\n\n` +
                    `<code>${pix.qr_code}</code>\n\n` +
                    `<i>Após pagar, o plano ativa automaticamente.</i>`,
                Markup.inlineKeyboard([[{ text: '🔙 Planos', callback_data: 'saas_planos' }]])
            );
        } catch (e) {
            await Msg.editCallbackPanel(ctx, `❌ ${e.message}`, Markup.inlineKeyboard([[{ text: '🔙', callback_data: 'saas_planos' }]]));
        }
    });

    bot.action('saas_switch', async (ctx) => {
        await ctx.answerCbQuery();
        const lojas = await getOwnerTenants(ctx);
        const rows = lojas.map((t) => [
            { text: `🏪 ${t.name}`, callback_data: `saas_pick_${t.id}` },
        ]);
        rows.push([{ text: '🔙', callback_data: 'saas_back' }]);
        await Msg.editCallbackPanel(ctx, '🔄 <b>Escolha a loja ativa:</b>', Markup.inlineKeyboard(rows));
    });

    bot.action(/^saas_pick_(\d+)$/, async (ctx) => {
        const id = Number(ctx.match[1]);
        await tenantSession.setActiveTenantId(String(ctx.from.id), id, stateManager);
        await ctx.answerCbQuery('Loja ativa!');
        await Msg.editCallbackPanel(ctx, '✅ Loja alterada. Use /admin_loja', Markup.inlineKeyboard([[{ text: '🏪 Painel', callback_data: 'saas_back' }]]));
    });

    bot.action('saas_back', async (ctx) => {
        await ctx.answerCbQuery();
        await showTenantPanel(ctx, deps);
    });

  // ── Platform admin ─────────────────────────────────────────────────────
    bot.command('admin_saas', async (ctx) => {
        if (!isPlatformAdmin(ctx.from.id)) return;
        const { rows, total } = TenantService.getAll({ page: 1, limit: 15 });
        if (!rows.length) return Msg.reply(ctx, 'Nenhum lojista cadastrado.');
        const text =
            `👥 <b>Plataforma Hanork</b> — ${total} loja(s)\n\n` +
            rows.map((t) => `• <b>${t.name}</b> <code>${t.slug}</code> — ${t.plan_label || t.plan}`).join('\n');
        await Msg.reply(
            ctx,
            text,
            Markup.inlineKeyboard([
                [{ text: '📋 Listar todas', callback_data: 'saas_adm_list' }],
                [{ text: '📊 Métricas', callback_data: 'saas_adm_metrics' }],
                [{ text: '🔙 Admin', callback_data: 'a_menu' }],
            ])
        );
    });

    bot.action('saas_adm_list', async (ctx) => {
        if (!isPlatformAdmin(ctx.from.id)) await denyCbSilent('admin_callback', ctx); return;
        await ctx.answerCbQuery();
        const { rows } = TenantService.getAll({ page: 1, limit: 30 });
        const lines = rows.map(
            (t) =>
                `${t.active ? '✅' : '❌'} <b>${t.name}</b>\n` +
                `   <code>${t.slug}</code> · ${t.plan} · owner ${t.owner_telegram_id}`
        );
        await Msg.editCallbackPanel(
            ctx,
            `👥 <b>Lojistas</b>\n\n${lines.join('\n\n')}`,
            Markup.inlineKeyboard(rows.slice(0, 8).map((t) => [
                { text: `⚙️ ${t.name}`, callback_data: `saas_adm_t_${t.id}` },
            ])).concat([[{ text: '🔙', callback_data: 'saas_adm_back' }]])
        );
    });

    bot.action(/^saas_adm_t_(\d+)$/, async (ctx) => {
        if (!isPlatformAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery();
        const t = TenantService.getById(Number(ctx.match[1]));
        if (!t) return;
        const s = TenantService.getStats(t.id);
        const vitrine = siteBase() ? `${siteBase()}/loja/${t.slug}` : `/loja/${t.slug}`;
        await Msg.editCallbackPanel(
            ctx,
            `⚙️ <b>${t.name}</b>\n\n` +
                `Slug: <code>${t.slug}</code>\nPlano: ${t.plan}\nOwner: <code>${t.owner_telegram_id}</code>\n` +
                `Receita mês: R$ ${Number(s.revenue_month).toFixed(2)}\nPedidos: ${s.orders_month}\n` +
                `Vitrine: <code>${vitrine}</code>`,
            Markup.inlineKeyboard([
                [
                    { text: '⬆️ Pro', callback_data: `saas_adm_plan_${t.id}_pro` },
                    { text: '⬆️ Business', callback_data: `saas_adm_plan_${t.id}_business` },
                ],
                [
                    { text: t.active ? '⏸️ Suspender' : '✅ Ativar', callback_data: `saas_adm_toggle_${t.id}` },
                ],
                [{ text: '🔙 Lista', callback_data: 'saas_adm_list' }],
            ])
        );
    });

    bot.action(/^saas_adm_plan_(\d+)_(\w+)$/, async (ctx) => {
        if (!isPlatformAdmin(ctx.from.id)) return;
        const tenantId = Number(ctx.match[1]);
        const plan = ctx.match[2];
        const exp = new Date();
        exp.setMonth(exp.getMonth() + 1);
        TenantService.assignPlan(tenantId, plan, exp.toISOString());
        await ctx.answerCbQuery(`Plano ${plan} aplicado`);
        await Msg.reply(ctx, `✅ Tenant ${tenantId} → plano ${plan}`);
    });

    bot.action(/^saas_adm_toggle_(\d+)$/, async (ctx) => {
        if (!isPlatformAdmin(ctx.from.id)) return;
        const id = Number(ctx.match[1]);
        const t = TenantService.getById(id);
        TenantService.update(id, { active: t.active ? 0 : 1 });
        await ctx.answerCbQuery(t.active ? 'Suspenso' : 'Ativado');
        await Msg.reply(ctx, `✅ Loja ${t.name} ${t.active ? 'suspensa' : 'reativada'}`);
    });

    bot.action('saas_adm_metrics', async (ctx) => {
        if (!isPlatformAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery();
        const { total } = TenantService.getAll({ limit: 1 });
        const active = TenantService.getAll({ active: 1, limit: 1 }).total;
        await Msg.editCallbackPanel(
            ctx,
            `📊 <b>Métricas SaaS</b>\n\nLojas: ${total}\nAtivas: ${active}`,
            Markup.inlineKeyboard([[{ text: '🔙', callback_data: 'saas_adm_back' }]])
        );
    });

    bot.action('saas_adm_back', async (ctx) => {
        await ctx.answerCbQuery();
        await bot.telegram.sendMessage(ctx.chat.id, 'Use /admin_saas');
    });
}

module.exports = { registerSaasHandlers };
