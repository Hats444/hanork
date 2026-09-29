'use strict';

const { v4: uuidv4 } = require('uuid');
const logger = require('../../../config/logger');
const { prisma } = require('../../../config/database-sqlite');
const UserService = require('../../user/UserService');
const VirtuoCatalogService = require('./catalogService');
const VirtuoOrderRepository = require('../repositories/virtuoOrderRepository');
const { computeProfit, MP_MIN_PAYMENT_BRL } = require('./pricingService');
const { ORDER_STATUS } = require('../constants/orderStatuses');
const { formatQuoteBlock } = require('../utils/virtuoTextFormat');
const { buildCheckoutAffiliateHint } = require('../../affiliate/AffiliatePanels');
const { buildCheckoutWalletHint } = require('../../user/WalletPanels');
const { CB } = require('../utils/virtuoCallbackData');
const L = require('../utils/virtuoLabels');
const { meetsMpMinPayment } = require('../../smm/services/pricingService');
const { normServiceCode } = require('../utils/virtuoActivationResolver');
const { resolveCupomDiscount, formatCupomLine } = require('../../smm/helpers/smmCupomHelper');
const { cancelVirtuoHanorkOrder } = require('../helpers/virtuoOrderCancelHelper');
const { assertServiceAvailable } = require('./virtuoStockService');

function pendingVirtuoMatches(pending, { serviceId }) {
    if (!pending || pending.orderKind !== 'virtuo' || !pending.virtuo) return false;
    return Number(pending.virtuo.serviceId) === Number(serviceId);
}

async function abandonStalePending(key, pending, comprasPendentes) {
    if (!pending?.orderId) return;
    try {
        await prisma.order.update({
            where: { id: pending.orderId },
            data: { status: 'FAILED' },
        });
    } catch {
        /* ignore */
    }
    if (pending.orderKind === 'virtuo') {
        cancelVirtuoHanorkOrder(pending.orderId);
    }
    await comprasPendentes.delete(key).catch(() => {});
}

const VirtuoCheckoutService = {
    async createPaymentSession(ctx, deps, { serviceId, expectedServiceCode = null }) {
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

        const quote = VirtuoCatalogService.quote(serviceId);
        if (quote.error) {
            return { ok: false, error: quote.error, message: 'Serviço indisponível no momento.' };
        }
        const svc = quote.service;

        if (expectedServiceCode && normServiceCode(svc.service_code) !== normServiceCode(expectedServiceCode)) {
            logger.warn('[Virtuo:checkout] service mismatch no callback buy', {
                expectedServiceCode,
                actual: svc.service_code,
                serviceId,
            });
            return {
                ok: false,
                error: 'service_mismatch',
                message: 'Este botão expirou. Volte ao catálogo e escolha o app novamente.',
            };
        }

        const stock = await assertServiceAvailable(svc);
        if (!stock.ok) {
            return {
                ok: false,
                error: stock.reason,
                message:
                    'Este país está sem números no momento.\n\n<i>Escolha outro país ou tente novamente em alguns minutos.</i>',
            };
        }
        const svcLive = stock.svc || svc;

        if (normServiceCode(svcLive.service_code) !== normServiceCode(svc.service_code)) {
            return {
                ok: false,
                error: 'service_unavailable',
                message: 'Serviço indisponível — dados inconsistentes.',
            };
        }

        const pendingActive = VirtuoOrderRepository.findPendingByTelegram(telegramId);
        if (pendingActive) {
            return {
                ok: false,
                error: 'pending_activation',
                message: 'Você já tem um número aguardando SMS. Conclua ou aguarde antes de comprar outro.',
            };
        }

        const user = await UserService.getOrCreate(telegramId);

        const existingPending = await comprasPendentes.get(key);
        if (existingPending?.orderId) {
            const existingOrder = await prisma.order.findUnique({ where: { id: existingPending.orderId } });
            if (existingOrder?.status === 'WAITING_PAYMENT') {
                if (pendingVirtuoMatches(existingPending, { serviceId })) {
                    return {
                        ok: true,
                        reused: true,
                        orderId: existingOrder.id,
                        total: Number(existingOrder.total),
                        service: svc,
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

        let saleTotal = quote.sale_total;
        let cupomDiscount = 0;
        let cupomCode = null;

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
                message: `Valor mínimo para PIX/cartão: <b>R$ ${MP_MIN_PAYMENT_BRL.toFixed(2).replace('.', ',')}</b>.`,
            };
        }

        const costTotal = quote.cost_total;
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

        const virtuoRow = VirtuoOrderRepository.create({
            telegram_id: telegramId,
            hanork_order_id: orderId,
            virtuo_service_id: svcLive.id,
            service_code: svcLive.service_code,
            country_id: svcLive.country_id,
            service_name: svcLive.service_name,
            country_name: svcLive.country_name,
            cost: costTotal,
            sale_price: saleTotal,
            profit,
            server: svcLive.server || 1,
            status: ORDER_STATUS.AWAITING_PAYMENT,
        });

        await comprasPendentes.set(key, {
            orderId,
            userId: user.id,
            total: saleTotal,
            orderKind: 'virtuo',
            items: [],
            virtuo: {
                virtuoOrderId: virtuoRow.id,
                serviceId: svcLive.id,
                serviceCode: svcLive.service_code,
                countryId: svcLive.country_id,
                serviceName: svcLive.service_name,
                countryName: svcLive.country_name,
            },
            ...(cupomCode ? { cupomCode, cupomDiscount } : {}),
            externalRef: orderId,
            createdAt: Date.now(),
            _ts: Date.now(),
        });

        logger.info('[Virtuo:checkout] Pedido criado', {
            orderId,
            serviceId,
            serviceCode: svcLive.service_code,
            countryId: svcLive.country_id,
            total: saleTotal,
        });

        return {
            ok: true,
            orderId,
            total: saleTotal,
            virtuoOrderId: virtuoRow.id,
            service: svcLive,
            saleTotal,
            cupomDiscount,
            cupomCode,
        };
    },

    buildPaymentMessage(orderId, svc, saleTotal, affSaldo = 0, cupomDiscount = 0, cupomCode = null, walletSaldo = 0) {
        const quoteText = formatQuoteBlock(svc, saleTotal);
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
            backCallback: CB.HOME,
            backLabel: L.HOME,
            walletSaldo: walletSaldo || 0,
        });
    },
};

module.exports = VirtuoCheckoutService;
