'use strict';

const OrderService = require('../../modules/order/OrderService');
const UserService = require('../../modules/user/UserService');

const CHECKOUT_COOLDOWN_MS = 30000;

function createCheckoutBridge(deps) {
    const {
        getBot,
        groupGuard,
        prisma,
        Cart,
        comprasPendentes,
        getAffSaldo,
        Menu,
        Markup,
        Msg,
        cuponsAplicados,
        getProductById,
        getReplyWithMenuPhoto,
    } = deps;

    function cartKey(ctx) {
        return ctx.from?.id ?? null;
    }

    function isGroupChat(ctx) {
        return groupGuard.isGroupChat(ctx);
    }

    async function requirePrivate(ctx, message = '🔒 Por segurança, conclua sua compra em conversa privada comigo.') {
        return groupGuard.requirePrivate(ctx, getBot(), { body: message });
    }

    async function createOrder(telegramId, items, calculatedTotal = null) {
        const user = await UserService.getOrCreate(telegramId);
        return OrderService.create(user.id, telegramId, items, calculatedTotal);
    }

    async function checkCheckoutCooldown(userId, telegramId) {
        const status = await prisma.checkoutCooldown.check(userId);
        if (!status.allowed) {
            const remaining = Math.max(1, status.remaining_sec || 1);
            return { allowed: false, remaining };
        }
        await prisma.checkoutCooldown.set(userId, telegramId, CHECKOUT_COOLDOWN_MS / 1000);
        return { allowed: true };
    }

    function checkoutDeps() {
        return {
            cartKey,
            Cart,
            createOrder,
            prisma,
            comprasPendentes,
        getAffSaldo,
        getWalletSaldo: deps.getWalletSaldo,
        checkCheckoutCooldown,
            Menu,
            Markup,
            Msg,
            cuponsAplicados,
            replyWithMenuPhoto: getReplyWithMenuPhoto(),
        };
    }

    async function runCheckout(ctx) {
        if (!(await requirePrivate(ctx))) return { ok: false };
        return require('../../services/CheckoutService').processCheckout(ctx, checkoutDeps());
    }

    async function startBuyProduct(ctx, pid) {
        if (!(await requirePrivate(ctx))) return false;
        const p = await getProductById(pid);
        if (!p) {
            await Msg.reply(ctx, '❌ Produto não encontrado ou indisponível.', Markup.inlineKeyboard([
                [{ text: '🛍️ Catálogo', callback_data: 'catalog:view' }],
                [{ text: '🏠 Menu', callback_data: 'menu:home' }],
            ]), { forceNew: true });
            return false;
        }
        await Cart.clear(cartKey(ctx));
        await Cart.add(cartKey(ctx), pid, 1);
        const result = await runCheckout(ctx);
        if (result?.ok) return true;
        await Msg.reply(
            ctx,
            `⚠️ <b>Não foi possível abrir o pagamento</b>\n\n` +
            `O pedido pode ter sido criado. Use /checkout ou toque abaixo para tentar de novo.`,
            Markup.inlineKeyboard([
                [{ text: '💳 Tentar pagamento', callback_data: 'checkout' }],
                [{ text: '🛍️ Catálogo', callback_data: 'catalog:view' }],
            ]),
            { forceNew: true }
        );
        return false;
    }

    return {
        cartKey,
        isGroupChat,
        requirePrivate,
        createOrder,
        checkCheckoutCooldown,
        checkoutDeps,
        runCheckout,
        startBuyProduct,
    };
}

module.exports = { createCheckoutBridge };
