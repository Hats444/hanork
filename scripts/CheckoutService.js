'use strict';

const logger = require('../config/logger');
const { withLockOrSkip } = require('../infrastructure/DistributedStateManager');
const { unwrapReplyMarkup } = require('../telegram/messageDelivery');
const { buildCheckoutAffiliateHint } = require('../modules/affiliate/AffiliatePanels');

class CheckoutService {
    /**
     * Exibe tela de pagamento — no PV via /start (grupo→privado) sempre envia mensagem nova.
     */
    async _showPaymentScreen(ctx, deps, text, markup, extraOpts = {}) {
        const kb = markup;
        const fromCallback = !!ctx.callbackQuery;
        let productPhoto = extraOpts.photo || null;
        if (!productPhoto && extraOpts.preferProductPhoto !== false) {
            try {
                const pending = await deps.comprasPendentes?.get?.(deps.cartKey(ctx));
                const pid = pending?.items?.[0]?.product_id;
                if (pid && deps.prisma?.product?.findUnique) {
                    const p = await deps.prisma.product.findUnique({ where: { id: pid } });
                    if (p) {
                        const { resolveProductPhotoInput } = require('../utils/productPhoto');
                        const { CONFIG } = require('../config/config');
                        productPhoto = resolveProductPhotoInput(p, CONFIG?.CAMINHO_FOTOS || null);
                    }
                }
            } catch { /* ignore */ }
        }
        const opts = {
            useMenuPhoto: !productPhoto,
            skipMenuPhoto: !!productPhoto,
            photoUrl: productPhoto || undefined,
            forceNew: !fromCallback,
        };

        try {
            const fn = fromCallback ? deps.Msg.edit : deps.Msg.reply;
            const r = await fn(ctx, text, kb, opts);
            if (r?.messageId) return true;
        } catch (e) {
            logger.warn('[CheckoutService] payment UI primary failed', { message: e?.message, uid: ctx.from?.id });
        }

        if (deps.replyWithMenuPhoto) {
            try {
                await deps.replyWithMenuPhoto(ctx, text, kb, { forceNew: true });
                return true;
            } catch (e) {
                logger.warn('[CheckoutService] payment UI menu photo failed', { message: e?.message });
            }
        }

        try {
            await deps.Msg.reply(ctx, text, kb, { useMenuPhoto: true, forceNew: true });
            return true;
        } catch (e) {
            logger.error('[CheckoutService] payment UI fallback failed', { message: e?.message, uid: ctx.from?.id });
            return false;
        }
    }

    async processCheckout(ctx, deps) {
        const groupGuard = require('../telegram/groupGuard');
        if (groupGuard.isGroupChat(ctx)) {
            logger.warn('[CheckoutService] checkout bloqueado em grupo', { uid: ctx.from?.id });
            if (deps.bot) {
                await groupGuard.replyGroupRedirect(ctx, deps.bot, {});
            }
            return { ok: false, reason: 'group' };
        }
        const key = deps.cartKey(ctx);
        const uid = ctx.from?.id;
        if (!uid || !key) {
            await deps.Msg.reply(ctx, '❌ Não foi possível identificar sua conta. Use /start no privado.', null, { forceNew: true });
            return { ok: false, reason: 'no_user' };
        }

        const result = await withLockOrSkip(`checkout:${uid}`, 15000, async () => {
            const user = await deps.prisma.user.findUnique({
                where: { telegram_id: String(uid) },
            });
            if (!user) {
                await deps.Msg.reply(ctx, '❌ Faça /start primeiro.', null, { forceNew: true });
                return { ok: false, reason: 'no_user' };
            }

            const pending = await deps.comprasPendentes?.get?.(key);
            if (pending?.orderId) {
                const existing = await deps.prisma.order.findUnique({ where: { id: pending.orderId } });
                if (existing?.status === 'WAITING_PAYMENT') {
                    const affSaldo = await deps.getAffSaldo(uid);
                    const paymentText =
                        `<b>🛒 Pedido #${existing.id.slice(-8)}</b>\n\n` +
                        `💰 <b>R$ ${Number(existing.total).toFixed(2)}</b>\n\n` +
                        `<i>Você já tem um pagamento em aberto.</i>\n` +
                        `Escolha a forma de pagamento abaixo:` +
                        buildCheckoutAffiliateHint(affSaldo, Number(existing.total));
                    await this._showPaymentScreen(
                        ctx,
                        deps,
                        paymentText,
                        deps.Menu.pagamento(existing.id, affSaldo, Number(existing.total))
                    );
                    logger.info('[CheckoutService] pending reused', { orderId: existing.id, uid });
                    return { ok: true, orderId: existing.id, reason: 'existing_pending' };
                }
                if (existing && existing.status !== 'WAITING_PAYMENT') {
                    await deps.comprasPendentes.delete(key).catch(() => {});
                }
            }

            const cooldown = await deps.checkCheckoutCooldown(user.id, uid);
            if (!cooldown.allowed) {
                logger.info('[CheckoutService] cooldown', { uid, remaining: cooldown.remaining });
                await deps.Msg.reply(ctx, `⏳ Aguarde ${cooldown.remaining}s para novo checkout.`, null, { forceNew: true });
                return { ok: false, reason: 'cooldown' };
            }

            const items = await deps.Cart.items(key);
            if (!items?.length) {
                logger.warn('[CheckoutService] carrinho vazio', { uid, key });
                await deps.Msg.reply(ctx, '🛒 Carrinho vazio.', null, { forceNew: true });
                return { ok: false, reason: 'empty_cart' };
            }

            const { resolveCheckoutPrice } = require('../modules/flash/flashPricing');
            const orderItems = [];
            let flashSaleId = null;
            for (const item of items) {
                const pid = item.product_id || item.pid;
                const prod = await deps.prisma.product.findUnique({ where: { id: pid } });
                if (!prod?.active) {
                    logger.warn('[CheckoutService] produto inativo', { uid, pid });
                    await deps.Msg.reply(ctx, `❌ Indisponível: ${item.product_name || pid}`, null, { forceNew: true });
                    return { ok: false, reason: 'inactive_product' };
                }
                const pricing = resolveCheckoutPrice(prod);
                if (pricing.flashSaleId) flashSaleId = pricing.flashSaleId;
                const linePrice = pricing.price ?? item.product_price ?? item.price ?? prod.price;
                orderItems.push({
                    product_id: pid,
                    quantity: item.quantity || 1,
                    price: linePrice,
                    name: prod.name,
                    file_url: prod.file_url || '',
                    is_subscription: !!prod.is_subscription,
                });
            }

            let total = orderItems.reduce((s, i) => s + i.price * (i.quantity || 1), 0);
            const subDiscount = await deps.Cart.subscriptionDiscount(key, user.id);
            if (subDiscount.active) total -= subDiscount.discount;
            const cupom = await deps.cuponsAplicados?.get?.(key);
            if (cupom?.finalTotal != null) total = cupom.finalTotal;

            const order = await deps.createOrder(String(uid), orderItems, total);
            await deps.prisma.order.update({
                where: { id: order.id },
                data: { status: 'WAITING_PAYMENT' },
            });

            await deps.comprasPendentes.set(key, {
                orderId: order.id,
                userId: user.id,
                items: orderItems,
                total,
                externalRef: order.external_reference,
                createdAt: Date.now(),
                _ts: Date.now(),
                ...(flashSaleId ? { flashSaleId } : {}),
            });

            const affSaldo = await deps.getAffSaldo(uid);
            const prodNames = orderItems.map((i) => i.name).filter(Boolean).slice(0, 3);
            const prodLine = prodNames.length
                ? `\n📦 ${prodNames.join(', ')}${orderItems.length > 3 ? '…' : ''}`
                : '';
            const paymentText =
                `<b>🛒 Pedido #${order.id.slice(-8)}</b>${prodLine}\n\n` +
                `💰 <b>R$ ${total.toFixed(2)}</b>\n\n` +
                `Escolha a forma de pagamento abaixo:` +
                buildCheckoutAffiliateHint(affSaldo, total);
            const markup = deps.Menu.pagamento(order.id, affSaldo, total);
            const uiOk = await this._showPaymentScreen(ctx, deps, paymentText, markup);
            if (!uiOk) {
                logger.error('[CheckoutService] UI pagamento não exibida', { orderId: order.id, uid });
                await deps.Msg.reply(
                    ctx,
                    `⚠️ <b>Pedido #${order.id.slice(-8)} criado</b>, mas a tela de pagamento não abriu.\n\n` +
                    `Use /start ou toque em «Já paguei» na mensagem anterior.\n` +
                    `Valor: <b>R$ ${total.toFixed(2)}</b>`,
                    deps.Menu.pagamento(order.id, affSaldo, total),
                    { forceNew: true }
                ).catch(() => {});
                return { ok: false, orderId: order.id, reason: 'ui_failed' };
            }

            logger.info('[CheckoutService] ok', { orderId: order.id, uid, ui: 'shown' });
            return { ok: true, orderId: order.id };
        });

        if (result === null) {
            logger.warn('[CheckoutService] lock ocupado', { uid });
            if (ctx.callbackQuery?.message) {
                try {
                    await deps.Msg.edit(
                        ctx,
                        '⏳ <b>Checkout em andamento</b>\n\n<i>Aguarde — seu pedido anterior ainda está sendo processado.</i>',
                        deps.Markup.inlineKeyboard([
                            [{ text: '⏳ Processando...', callback_data: 'checkout:processing' }],
                        ]),
                        { parse_mode: 'HTML' }
                    );
                } catch {
                    await deps.Msg.reply(ctx, '⏳ Aguarde, seu checkout anterior ainda está sendo processado.', null, { forceNew: true });
                }
            } else {
                await deps.Msg.reply(ctx, '⏳ Aguarde, seu checkout anterior ainda está sendo processado.', null, { forceNew: true });
            }
            return { ok: false, reason: 'lock' };
        }
        return result;
    }
}

module.exports = new CheckoutService();
