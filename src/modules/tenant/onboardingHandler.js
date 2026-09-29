/**
 * onboardingHandler — wizard de cadastro do lojista via Telegram
 */
'use strict';

const { Markup } = require('telegraf');
const Msg = require('../../telegram/Msg');
const TenantService = require('./TenantService');
const logger = require('../../config/logger');

const SESSION_KEY = (tid) => `onboarding:${tid}`;
const SESSION_TTL_SEC = 3600;
const SESSION_TTL_MS = SESSION_TTL_SEC * 1000;

const STEPS = {
    0: { key: 'name', prompt: '🏪 <b>Qual é o nome da sua loja?</b>\n\nEx: <i>Loja do João</i>' },
    1: { key: 'token_mp', prompt: '💳 <b>Token MercadoPago</b> (opcional)\n\nCole o token <code>APP_USR-...</code> para pagamentos automáticos.\nOu envie <code>pular</code> para configurar depois.' },
    2: { key: 'email', prompt: '📧 <b>Email padrão para PIX</b>\n\nEste email aparece na cobrança PIX do MercadoPago.\nEx: <code>loja@meudominio.com</code>' },
    3: { key: 'confirm', prompt: null },
};

let _stateManager = null;

function setOnboardingStateManager(sm) {
    _stateManager = sm;
}

async function getSession(tid) {
    if (_stateManager) return _stateManager.get(SESSION_KEY(tid));
    return null;
}

async function setSession(tid, data) {
    if (_stateManager) return _stateManager.set(SESSION_KEY(tid), data, SESSION_TTL_MS);
}

async function delSession(tid) {
    if (_stateManager) return _stateManager.delete(SESSION_KEY(tid));
}

function buildConfirmText(data) {
    return (
        `✅ <b>Confirmar criação da loja?</b>\n\n` +
        `🏪 Nome: <b>${data.name}</b>\n` +
        `💳 Token MP: ${data.token_mp && data.token_mp !== 'pular' ? '✅ Configurado' : '⏭️ Pulado'}\n` +
        `📧 Email PIX: <code>${data.email || 'não informado'}</code>\n` +
        `📦 Plano: <b>Free</b> (5 produtos, 50 pedidos/mês)\n\n` +
        `_Após confirmar, use /admin_loja para o painel da loja._`
    );
}

async function isOnboarding(telegramId) {
    const s = await getSession(String(telegramId));
    return s != null && typeof s.step === 'number';
}

async function startOnboarding(ctx) {
    const tid = String(ctx.from.id);
    const existing = TenantService.getByOwner(tid);
    if (existing.length > 0) {
        return Msg.reply(
            ctx,
            `🏪 Você já tem ${existing.length} loja(s) cadastrada(s):\n\n` +
                existing.map((t) => `• <b>${t.name}</b> (/${t.slug}) — plano ${t.plan}`).join('\n') +
                `\n\nUse /admin_loja para gerenciar ou /registrar_loja para criar outra.`
        );
    }
    await setSession(tid, { step: 0, data: {}, _ts: Date.now() });
    await Msg.replaceMenu(
        ctx,
        `🚀 <b>Bem-vindo ao Hanork!</b>\n\nVamos configurar sua loja em 3 passos rápidos.\n\n` + STEPS[0].prompt,
        Markup.inlineKeyboard([[{ text: '❌ Cancelar', callback_data: 'onb_cancel' }]])
    );
}

async function handleOnboardingMessage(ctx) {
    const tid = String(ctx.from.id);
    const session = await getSession(tid);
    if (!session) return false;

    const text = ctx.message?.text?.trim() || '';
    const { step, data } = session;

    if (step === 0) {
        if (text.length < 2 || text.length > 60) {
            await Msg.reply(ctx, '⚠️ Nome deve ter entre 2 e 60 caracteres. Tente novamente:');
            return true;
        }
        data.name = text;
        session.step = 1;
        await setSession(tid, session);
        await Msg.replaceMenu(ctx, STEPS[1].prompt, Markup.inlineKeyboard([
            [{ text: '⏭️ Pular', callback_data: 'onb_skip_mp' }, { text: '❌ Cancelar', callback_data: 'onb_cancel' }],
        ]));
        return true;
    }

    if (step === 1) {
        const val = text.toLowerCase() === 'pular' ? null : text;
        if (val && !val.startsWith('APP_USR-') && !val.startsWith('TEST-')) {
            await Msg.reply(ctx, '⚠️ Token inválido. Deve começar com <code>APP_USR-</code> ou <code>TEST-</code>. Envie <code>pular</code> para pular.', { parse_mode: 'HTML' });
            return true;
        }
        data.token_mp = val;
        session.step = 2;
        await setSession(tid, session);
        await Msg.replaceMenu(ctx, STEPS[2].prompt, Markup.inlineKeyboard([
            [{ text: '⏭️ Pular', callback_data: 'onb_skip_email' }, { text: '❌ Cancelar', callback_data: 'onb_cancel' }],
        ]));
        return true;
    }

    if (step === 2) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(text)) {
            await Msg.reply(ctx, '⚠️ Email inválido. Tente novamente ou envie <code>pular</code>:', { parse_mode: 'HTML' });
            return true;
        }
        data.email = text;
        session.step = 3;
        await setSession(tid, session);
        await Msg.replaceMenu(ctx, buildConfirmText(data), Markup.inlineKeyboard([
            [{ text: '✅ Confirmar e criar loja', callback_data: 'onb_confirm' }],
            [{ text: '❌ Cancelar', callback_data: 'onb_cancel' }],
        ]));
        return true;
    }

    return true;
}

async function handleOnboardingCallback(ctx) {
    const data = ctx.callbackQuery?.data || '';
    const tid = String(ctx.from.id);
    const session = await getSession(tid);

    if (data === 'onb_cancel') {
        await delSession(tid);
        await ctx.answerCbQuery('Cadastro cancelado.');
        await Msg.edit(ctx, '❌ Cadastro da loja cancelado. Use /registrar_loja para tentar novamente.');
        return true;
    }

    if (data === 'onb_skip_mp' && session) {
        session.data.token_mp = null;
        session.step = 2;
        await setSession(tid, session);
        await ctx.answerCbQuery();
        await Msg.edit(ctx, STEPS[2].prompt, Markup.inlineKeyboard([
            [{ text: '⏭️ Pular', callback_data: 'onb_skip_email' }, { text: '❌ Cancelar', callback_data: 'onb_cancel' }],
        ]));
        return true;
    }

    if (data === 'onb_skip_email' && session) {
        session.data.email = null;
        session.step = 3;
        await setSession(tid, session);
        await ctx.answerCbQuery();
        await Msg.edit(ctx, buildConfirmText(session.data), Markup.inlineKeyboard([
            [{ text: '✅ Confirmar e criar loja', callback_data: 'onb_confirm' }],
            [{ text: '❌ Cancelar', callback_data: 'onb_cancel' }],
        ]));
        return true;
    }

    if (data === 'onb_confirm' && session) {
        await ctx.answerCbQuery('⏳ Criando sua loja...');
        try {
            const tenant = TenantService.create({
                name: session.data.name,
                owner_telegram_id: tid,
                plan: 'free',
            });
            if (session.data.token_mp) TenantService.update(tenant.id, { token_mp: session.data.token_mp });
            if (session.data.email) TenantService.update(tenant.id, { mp_payer_email: session.data.email });
            TenantService.completeOnboarding(tenant.id);
            TenantService.migrateDataToTenant(tenant.id, tid);

            try {
                const { applyStarterKit } = require('./starterKit');
                const kit = applyStarterKit(tenant.id);
                if (kit.coupon) {
                    logger.info(`[ONBOARDING] Starter kit: cupom BV${tenant.id}`);
                }
            } catch (e) {
                logger.warn('[ONBOARDING] starter kit:', e.message);
            }

            const tenantSession = require('./tenantSession');
            if (_stateManager) await tenantSession.setActiveTenantId(tid, tenant.id, _stateManager);

            await delSession(tid);
            logger.info(`[ONBOARDING] Loja criada: ${tenant.slug} por ${tid}`);
            const vitrine = (process.env.SITE_HANORK || '').replace(/\/$/, '');
            await Msg.edit(
                ctx,
                `🎉 <b>Loja criada com sucesso!</b>\n\n` +
                    `🏪 <b>${tenant.name}</b>\n` +
                    `🔗 Slug: <code>${tenant.slug}</code>\n` +
                    `📦 Plano: <b>Free</b>\n\n` +
                    (vitrine ? `🌐 Vitrine: <code>${vitrine}/loja/${tenant.slug}</code>\n\n` : '') +
                    `<b>Próximos passos:</b>\n` +
                    `• /addproduto — produtos\n` +
                    `• /admin_loja — painel\n` +
                    `• /planos — upgrade\n` +
                    `• Cupom <code>BV${tenant.id}</code> (10% off) já criado para seus clientes`,
                Markup.inlineKeyboard([[{ text: '🏪 Painel da loja', callback_data: 'saas_back' }]])
            );
        } catch (e) {
            logger.error(`[ONBOARDING] Erro ao criar loja: ${e.message}`);
            await Msg.edit(ctx, '❌ Erro ao criar loja. Tente novamente com /registrar_loja');
        }
        return true;
    }

    return false;
}

function registerOnboardingHandlers(bot) {
    bot.command('registrar_loja', startOnboarding);

    bot.command('planos', async (ctx) => {
        const plans = TenantService.getPlans();
        const text = plans
            .map((p) => {
                const features = [];
                if (p.allow_affiliates) features.push('🤝 Programa de afiliados');
                if (p.allow_ai) features.push('🤖 Suporte com IA');
                if (p.allow_flash_sale) features.push('🔥 Ofertas relâmpago');
                if (p.allow_subscriptions) features.push('🔑 Produtos por assinatura');
                const broadcasts =
                    p.max_broadcasts_month >= 99
                        ? 'Divulgações ilimitadas'
                        : `${p.max_broadcasts_month} divulgações/mês`;
                return (
                    `<b>${p.label}</b> — ${p.price > 0 ? `R$ ${p.price.toFixed(2)}/mês` : 'Grátis'}\n` +
                    `  • ${p.max_products >= 999 ? '∞' : p.max_products} produtos no catálogo\n` +
                    `  • ${p.max_orders_month >= 9999 ? '∞' : p.max_orders_month} pedidos/mês\n` +
                    `  • ${broadcasts}\n` +
                    (features.length ? `  • ${features.join('\n  • ')}\n` : '')
                );
            })
            .join('\n');
        await Msg.reply(
            ctx,
            `📦 <b>Planos Hanork</b>\n\n${text}\n\n` +
                `<b>Free</b> — começar a vender\n` +
                `<b>Pro</b> — escalar com afiliados, flash e IA\n` +
                `<b>Business</b> — assinaturas e volume alto\n\n` +
                `Upgrade com PIX: <code>/admin_loja</code> → Planos`
        );
    });
}

module.exports = {
    registerOnboardingHandlers,
    handleOnboardingMessage,
    handleOnboardingCallback,
    isOnboarding,
    startOnboarding,
    setOnboardingStateManager,
};
