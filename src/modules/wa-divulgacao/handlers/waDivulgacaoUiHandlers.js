'use strict';

const WaDivulgacaoConfig = require('../waDivulgacaoConfig');
const WaDivulgacaoSubscriptionService = require('../waDivulgacaoSubscriptionService');
const Copy = require('../waDivulgacaoCopy');
const { waDivulgacaoPanel } = require('../helpers/waDivulgacaoPanelUi');
const { plansKeyboard, activePanelKeyboard, connectChoiceKeyboard, stubBackKeyboard, phonePromptKeyboard, pairingFlowKeyboard, qrFlowKeyboard } = require('../keyboards/waDivulgacaoKeyboards');
const { requireBotContext } = require('../../../telegram/callbacks/BotContext');

function deps() {
    return requireBotContext(['Msg', 'prisma', 'Cart', 'cartKey']);
}

async function buildActiveHomePanel(telegramId) {
    const { prisma } = deps();
    const user = await prisma.user.findUnique({ where: { telegram_id: String(telegramId) } });
    if (!user) return null;

    const sub = WaDivulgacaoSubscriptionService.findActive(user.id);
    if (!sub) return null;

    const { getWaDivulgacaoLoginService } = require('../waDivulgacaoLoginService');
    const { historyTotals } = require('../waDivulgacaoStore');
    const login = getWaDivulgacaoLoginService();
    const resolved = await login.resolveConnectionForPanel(telegramId);
    const conn = resolved.state || {};
    if (!resolved.connected) {
        const { scheduleWorkerPrewarm } = require('../waDivulgacaoWorkerService');
        scheduleWorkerPrewarm(telegramId, 'home');
    }
    const hist = historyTotals(telegramId);
    const scheduled = hist.rows.filter((r) => r.status === 'scheduled').length;
    return {
        text: WaDivulgacaoSubscriptionService.formatActivePanel(sub, conn, {
            sent: hist.sent,
            campaigns: hist.campaigns,
            scheduled,
        }),
        keyboard: activePanelKeyboard(sub, Boolean(resolved.connected)),
        connected: Boolean(resolved.connected),
    };
}

async function sendWaDivulgacaoHome(ctx) {
    const { Msg, prisma } = deps();
    const user = await prisma.user.findUnique({ where: { telegram_id: String(ctx.from.id) } });
    if (!user) {
        return waDivulgacaoPanel(ctx, Msg, '❌ Inicie o bot com /start', {
            inline_keyboard: [[{ text: '🏠 Menu', callback_data: 'menu:home' }]],
        });
    }

    const sub = WaDivulgacaoSubscriptionService.findActive(user.id);
    if (sub) {
        const panel = await buildActiveHomePanel(ctx.from.id);
        if (!panel) {
            const products = WaDivulgacaoSubscriptionService.listPlanProducts();
            return waDivulgacaoPanel(
                ctx,
                Msg,
                WaDivulgacaoSubscriptionService.formatPlansPanel(products, ctx),
                plansKeyboard(products)
            );
        }
        return waDivulgacaoPanel(ctx, Msg, panel.text, panel.keyboard);
    }

    const products = WaDivulgacaoSubscriptionService.listPlanProducts();
    return waDivulgacaoPanel(
        ctx,
        Msg,
        WaDivulgacaoSubscriptionService.formatPlansPanel(products, ctx),
        plansKeyboard(products)
    );
}

async function sendWaDivulgacaoPlans(ctx) {
    const { Msg } = deps();
    const products = WaDivulgacaoSubscriptionService.listPlanProducts();
    return waDivulgacaoPanel(
        ctx,
        Msg,
        WaDivulgacaoSubscriptionService.formatPlansPanel(products, ctx),
        plansKeyboard(products)
    );
}

async function sendStubSection(ctx, title, body) {
    const { Msg } = deps();
    return waDivulgacaoPanel(
        ctx,
        Msg,
        `<b>${title}</b>\n\n${body}\n\n<i>🚧 Em desenvolvimento — chega nas próximas atualizações.</i>`,
        stubBackKeyboard()
    );
}

async function buyPlan(ctx, productId) {
    const { Msg, prisma, Cart, cartKey } = deps();
    const user = await prisma.user.findUnique({ where: { telegram_id: String(ctx.from.id) } });
    if (!user) {
        return waDivulgacaoPanel(ctx, Msg, '❌ Faça /start primeiro.', {
            inline_keyboard: [[{ text: '🏠 Menu', callback_data: 'menu:home' }]],
        });
    }

    const pid = parseInt(productId, 10);
    const product = await prisma.product.findUnique({ where: { id: pid } });
    if (!product?.active || !product.is_subscription) {
        return waDivulgacaoPanel(ctx, Msg, '❌ Plano indisponível.', stubBackKeyboard('wadv:plans'));
    }

    const key = cartKey(ctx);
    await Cart.clear(key);
    await Cart.add(key, pid, 1);

    return waDivulgacaoPanel(
        ctx,
        Msg,
        Copy.formatCartPitch(product.name, product.price),
        {
            inline_keyboard: [
                [{ text: '🛒 Finalizar compra', callback_data: 'cart' }],
                [{ text: '🔙 Planos', callback_data: 'wadv:plans' }],
                [{ text: '🏠 Menu', callback_data: 'menu:home' }],
            ],
        }
    );
}

function isWaDivulgacaoEnabled() {
    return WaDivulgacaoConfig.enabled;
}

async function showWaDivPaymentSuccessPanel(ctx) {
    const { Msg } = deps();
    const { postPaymentKeyboard } = require('../keyboards/waDivulgacaoKeyboards');
    const { scheduleWorkerPrewarm } = require('../waDivulgacaoWorkerService');
    scheduleWorkerPrewarm(ctx.from.id, 'payment');
    return waDivulgacaoPanel(
        ctx,
        Msg,
        `✅ <b>Pagamento confirmado!</b>\n\n` + Copy.formatActivationBenefits(),
        postPaymentKeyboard()
    );
}

module.exports = {
    sendWaDivulgacaoHome,
    buildActiveHomePanel,
    sendWaDivulgacaoPlans,
    sendStubSection,
    buyPlan,
    isWaDivulgacaoEnabled,
    showWaDivPaymentSuccessPanel,
};
