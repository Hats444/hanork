'use strict';

const { v4: uuidv4 } = require('uuid');
const logger = require('../../../config/logger');
const { prisma } = require('../../../config/database-sqlite');
const UserService = require('../../user/UserService');
const CatalogService = require('./catalogService');
const SmmOrderRepository = require('../repositories/smmOrderRepository');
const { computeOrderCost, computeOrderTotal, computeProfit, effectiveMinQuantity, meetsMpMinPayment, MP_MIN_PAYMENT_BRL } = require('./pricingService');
const { findRecentDuplicate } = require('../helpers/smmDuplicateGuard');
const { assertCheckoutInput } = require('../validators/smmOrderValidator');
const { checkoutErrorMessage } = require('../validators/smmActionValidator');
const SmmConfig = require('../smmConfig');
const { ORDER_STATUS } = require('../constants/orderStatuses');
const { formatMoney, formatQuote } = require('../utils/smmTextFormat');
const { buildCheckoutAffiliateHint } = require('../../affiliate/AffiliatePanels');
const { buildCheckoutWalletHint } = require('../../user/WalletPanels');
const { CB: SMM_CB } = require('../utils/smmCallbackData');
const { resolveCupomDiscount, formatCupomLine } = require('../helpers/smmCupomHelper');
const { cancelSmmHanorkOrder } = require('../helpers/smmOrderCancelHelper');
const L = require('../utils/smmLabels');

function pendingSmmMatches(pending, { serviceId, link, quantity }) {
    if (!pending || pending.orderKind !== 'smm' || !pending.smm) return false;
    return (
        Number(pending.smm.serviceId) === Number(serviceId) &&
        String(pending.smm.link) === String(link) &&
        Number(pending.smm.quantity) === Number(quantity)
    );
}

async function abandonStalePending(key, pending, comprasPendentes) {
    if (!pending?.orderId) return;
    try {
        await prisma.order.update({
            where: { id: pending.orderId },
            data: { status: 'FAILED' },
        });
    } catch {
        /* pedido pode já ter sido removido */
    }
    if (pending.orderKind === 'smm') {
        cancelSmmHanorkOrder(pending.orderId);
    }
    await comprasPendentes.delete(key).catch(() => {});
}

const SmmCheckoutService = {
    async createPaymentSession(ctx, deps, { serviceId, link, quantity, comments = null }) {
        const {
            cartKey,
            comprasPendentes,
            Menu,
            getAffSaldo,
            checkCheckoutCooldown,
            cuponsAplicados,
        } = deps;

        const key = cartKey(ctx);
        const telegramId = String(ctx.from?.id);
        if (!key) return { ok: false, error: 'no_user' };

        const svc = CatalogService.getService(serviceId);
        if (!svc) return { ok: false, error: 'service_unavailable' };

        const validation = assertCheckoutInput(svc, link, quantity, comments);
        if (!validation.ok) {
            return { ok: false, error: validation.error, message: checkoutErrorMessage(validation.error) };
        }

        const dup = findRecentDuplicate(
            telegramId,
            svc.id,
            link,
            quantity,
            SmmConfig.duplicateWindowMinutes
        );
        if (dup) {
            return { ok: false, error: 'duplicate_order', message: checkoutErrorMessage('duplicate_order') };
        }

        const user = await UserService.getOrCreate(telegramId);

        const existingPending = await comprasPendentes.get(key);
        if (existingPending?.orderId) {
            const existingOrder = await prisma.order.findUnique({ where: { id: existingPending.orderId } });
            if (existingOrder?.status === 'WAITING_PAYMENT') {
                if (pendingSmmMatches(existingPending, { serviceId, link, quantity })) {
                    return {
                        ok: true,
                        reused: true,
                        orderId: existingOrder.id,
                        total: Number(existingOrder.total),
                        service: svc,
                        quantity: Number(quantity),
                        cupomDiscount: Number(existingPending.cupomDiscount) || 0,
                        cupomCode: existingPending.cupomCode || null,
                    };
                }
                await abandonStalePending(key, existingPending, comprasPendentes);
            } else if (existingOrder && existingOrder.status !== 'WAITING_PAYMENT') {
                await comprasPendentes.delete(key).catch(() => {});
            }
        }

        if (checkCheckoutCooldown) {
            const cooldown = await checkCheckoutCooldown(user.id, telegramId);
            if (!cooldown.allowed) {
                return { ok: false, error: 'cooldown', remaining: cooldown.remaining };
            }
        }

        const quote = CatalogService.quote(serviceId, quantity);
        let saleTotal = quote.sale_total;
        let cupomDiscount = 0;
        let cupomCode = null;

        if (quote?.error) {
            return { ok: false, error: 'quantity_out_of_range', message: checkoutErrorMessage('quantity_above_max') };
        }

        const payMinQty = effectiveMinQuantity(svc);
        if (Number(quantity) < payMinQty) {
            return {
                ok: false,
                error: 'payment_below_minimum',
                message:
                    `Valor mínimo para PIX/cartão: <b>R$ ${MP_MIN_PAYMENT_BRL.toFixed(2).replace('.', ',')}</b>.\n` +
                    `Use pelo menos <b>${payMinQty.toLocaleString('pt-BR')}</b> un.`,
                minQuantity: payMinQty,
            };
        }

        if (cuponsAplicados) {
            const cupomEntry = await cuponsAplicados.get(key);
            const cupomApplied = resolveCupomDiscount(saleTotal, cupomEntry);
            saleTotal = cupomApplied.total;
            cupomDiscount = cupomApplied.discount;
            cupomCode = cupomApplied.code;
        }

        if (!meetsMpMinPayment(saleTotal)) {
            return {
                ok: false,
                error: 'payment_below_minimum',
                message:
                    `Valor mínimo para PIX/cartão: <b>R$ ${MP_MIN_PAYMENT_BRL.toFixed(2).replace('.', ',')}</b>.\n` +
                    `Use pelo menos <b>${payMinQty.toLocaleString('pt-BR')}</b> un.`,
                minQuantity: payMinQty,
            };
        }

        const costTotal = computeOrderCost(svc.cost_price, quantity, svc.service_type);
        const profit = computeProfit(saleTotal, costTotal);

        const orderId = uuidv4();
        await prisma.order.create({
            data: {
                id: orderId,
                user_id: user.id,
                status: 'WAITING_PAYMENT',
                total: saleTotal,
                external_reference: orderId,
                order_items: [],
            },
        });

        const smmOrderRow = SmmOrderRepository.create({
            telegram_id: telegramId,
            hanork_order_id: orderId,
            provider: svc.provider,
            service_id: svc.id,
            link,
            quantity,
            provider_comments: comments || null,
            cost: costTotal,
            sale_price: saleTotal,
            profit,
            status: ORDER_STATUS.AWAITING_PAYMENT,
        });

        await comprasPendentes.set(key, {
            orderId,
            userId: user.id,
            total: saleTotal,
            orderKind: 'smm',
            items: [],
            smm: {
                smmOrderId: smmOrderRow.id,
                serviceId: svc.id,
                providerServiceId: svc.provider_service_id,
                link,
                quantity,
                comments: comments || null,
                serviceName: svc.name,
                platform: svc.platform,
            },
            ...(cupomCode ? { cupomCode, cupomDiscount } : {}),
            externalRef: orderId,
            createdAt: Date.now(),
            _ts: Date.now(),
        });

        logger.info('[SMM:checkout] Pedido criado', { orderId, serviceId, total: saleTotal });

        return {
            ok: true,
            orderId,
            total: saleTotal,
            smmOrderId: smmOrderRow.id,
            service: svc,
            quantity,
            saleTotal,
            cupomDiscount,
            cupomCode,
        };
    },

    buildPaymentMessage(orderId, svc, quantity, saleTotal, affSaldo = 0, cupomDiscount = 0, cupomCode = null, walletSaldo = 0) {
        const quoteText = formatQuote(svc, quantity, saleTotal, { step: 'payment' });
        const cupomLine = formatCupomLine(cupomDiscount, cupomCode);
        return (
            `${quoteText}${cupomLine}\n\n` +
            `Pedido <code>#${orderId.slice(-8)}</code>\n` +
            `Escolha a forma de pagamento abaixo:` +
            buildCheckoutAffiliateHint(affSaldo, saleTotal) +
            buildCheckoutWalletHint(walletSaldo, saleTotal)
        );
    },

    paymentKeyboard(orderId, affSaldo, total, Menu, walletSaldo = 0) {
        return Menu.pagamento(orderId, affSaldo || 0, total, {
            backCallback: SMM_CB.HOME,
            backLabel: L.HOME,
            walletSaldo: walletSaldo || 0,
        });
    },
};

module.exports = SmmCheckoutService;
