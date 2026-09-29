'use strict';

const logger = require('../../../config/logger');
const { prisma } = require('../../../config/database-sqlite');
const SmmOrderRepository = require('../repositories/smmOrderRepository');
const SmmServiceRepository = require('../repositories/smmServiceRepository');
const ProviderManager = require('../providers/ProviderManager');
const { ORDER_STATUS } = require('../constants/orderStatuses');
const { formatMoney } = require('../utils/smmTextFormat');
const { computeOrderCost, computeProfit } = require('./pricingService');
const { resolveFulfillCandidates } = require('./familyResolverService');
const { runPostFulfillBenefits } = require('./smmPostFulfillService');
const { notifyOrderBlockedForBalance } = require('./providerBalanceService');
const {
    notifyPaymentApproved,
    notifyOrderSent,
    sendUserNotification,
} = require('../helpers/smmUserNotify');

function extractProviderOrderId(raw) {
    if (!raw || raw.error) return null;
    return raw.order ?? raw.order_id ?? raw.id ?? null;
}

function extractProviderError(raw) {
    if (!raw) return 'empty_response';
    if (raw.error) return String(raw.message || raw.error).slice(0, 200);
    return null;
}

function recordOrderEvent(smmOrderId, eventType, detail) {
    try {
        prisma.smmOrderEvent.record(smmOrderId, eventType, detail);
    } catch (e) {
        logger.warn('[SMM:fulfill] event log falhou', { eventType, detail: e.message });
    }
}

const SmmFulfillmentService = {
    async fulfillHanorkOrder(hanorkOrderId, bot, opts = {}) {
        const smmOrder = SmmOrderRepository.findByHanorkOrderId(hanorkOrderId);
        if (!smmOrder) {
            return { ok: false, reason: 'smm_order_not_found' };
        }
        if (smmOrder.provider_order_id) {
            return { ok: true, reason: 'already_submitted', providerOrderId: smmOrder.provider_order_id };
        }
        if (!['awaiting_payment', 'paid', ORDER_STATUS.PAID].includes(smmOrder.status)) {
            if (smmOrder.status === ORDER_STATUS.SUBMITTED) {
                return { ok: true, reason: 'already_submitted' };
            }
        }

        const orderedService = SmmServiceRepository.findById(smmOrder.service_id);
        if (!orderedService) {
            SmmOrderRepository.updateStatus(smmOrder.id, ORDER_STATUS.FAILED);
            await this._failAndNotify({
                reason: 'service_not_found',
                hanorkOrderId,
                smmOrder,
                bot,
            });
            return { ok: false, reason: 'service_not_found' };
        }

        const candidates = resolveFulfillCandidates(orderedService, smmOrder.quantity);
        if (!candidates.length) {
            SmmOrderRepository.updateStatus(smmOrder.id, ORDER_STATUS.FAILED);
            await this._failAndNotify({
                reason: 'no_viable_service',
                hanorkOrderId,
                smmOrder,
                service: orderedService,
                bot,
            });
            return { ok: false, reason: 'no_viable_service' };
        }

        const guard = await ProviderManager.assertFulfillAllowed({
            candidates,
            quantity: smmOrder.quantity,
            orderedService,
        });
        if (!guard.ok) {
            SmmOrderRepository.updateStatus(smmOrder.id, ORDER_STATUS.FAILED);
            const detail =
                guard.reason === 'insufficient_provider_balance'
                    ? `balance=${guard.balance} required=${guard.required}`
                    : String(guard.reason);
            logger.error('[SMM:fulfill] compra segura bloqueou envio', {
                hanorkOrderId,
                reason: guard.reason,
                detail,
            });
            recordOrderEvent(smmOrder.id, 'SMM_BALANCE_BLOCK', detail);
            await this._failAndNotify({
                reason: guard.reason,
                hanorkOrderId,
                smmOrder,
                service: orderedService,
                detail,
                guard,
                bot,
            });
            return { ok: false, reason: guard.reason, guard };
        }

        SmmOrderRepository.updateStatus(smmOrder.id, ORDER_STATUS.PAID);

        await notifyPaymentApproved(bot, {
            orderId: hanorkOrderId,
            smmOrderId: smmOrder.id,
            telegramId: smmOrder.telegram_id,
        });

        let lastRaw = null;
        let usedService = null;
        let providerOrderId = null;
        let providerUsed = null;

        if (opts.providerOverride) {
            const provider = opts.providerOverride;
            for (let i = 0; i < candidates.length; i++) {
                const service = candidates[i];
                const raw = await provider.createOrder({
                    serviceId: service.provider_service_id,
                    link: smmOrder.link,
                    quantity: smmOrder.quantity,
                    comments: smmOrder.provider_comments || undefined,
                });
                lastRaw = raw;
                providerOrderId = extractProviderOrderId(raw);
                if (providerOrderId) {
                    usedService = service;
                    providerUsed = provider.name;
                    break;
                }
            }
        } else {
            const submit = await ProviderManager.submitOrderWithFallback({
                orderedService,
                candidates,
                link: smmOrder.link,
                quantity: smmOrder.quantity,
                comments: smmOrder.provider_comments || null,
            });
            lastRaw = submit.raw;
            providerOrderId = submit.providerOrderId;
            usedService = submit.usedService;
            providerUsed = submit.providerId;

            if (submit.ok && submit.fallback) {
                recordOrderEvent(
                    smmOrder.id,
                    'SMM_PROVIDER_FALLBACK',
                    `from=${ProviderManager.PRIMARY_ID} to=${submit.providerId}`
                );
                logger.info('[SMM:ProviderManager] fallback OK', {
                    hanorkOrderId,
                    providerId: submit.providerId,
                    attempt: submit.attempt,
                });
            }
        }

        if (!providerOrderId || !usedService) {
            SmmOrderRepository.updateStatus(smmOrder.id, ORDER_STATUS.FAILED);
            const failReason = ProviderManager.isDualProviderEnabled()
                ? 'all_providers_failed'
                : 'provider_rejected';
            logger.error('[SMM:fulfill] API rejeitou pedido', {
                hanorkOrderId,
                reason: failReason,
                detail: extractProviderError(lastRaw),
            });
            recordOrderEvent(smmOrder.id, 'SMM_ORDER', `failed reason=${failReason}`);
            const providerErr = extractProviderError(lastRaw);
            await this._failAndNotify({
                reason: failReason,
                hanorkOrderId,
                smmOrder,
                service: orderedService,
                detail: ProviderManager.isDualProviderEnabled()
                    ? `provedores indisponíveis · ${providerErr || 'sem resposta'}`
                    : `attempts=${candidates.length} err=${providerErr}`,
                bot,
            });
            return { ok: false, reason: failReason, raw: lastRaw };
        }

        const costTotal = computeOrderCost(usedService.cost_price, smmOrder.quantity, usedService.service_type);
        const profit = computeProfit(smmOrder.sale_price, costTotal);
        const serviceChanged = usedService.id && usedService.id !== orderedService.id;

        SmmOrderRepository.updateStatus(smmOrder.id, ORDER_STATUS.SUBMITTED, {
            provider_order_id: String(providerOrderId),
            provider_used: providerUsed || smmOrder.provider,
            ...(serviceChanged
                ? { service_id: usedService.id, cost: costTotal, profit }
                : {}),
        });

        recordOrderEvent(
            smmOrder.id,
            'SMM_ORDER',
            `ok provider=${providerUsed || smmOrder.provider} order=${providerOrderId} svc=${usedService.provider_service_id}` +
            (serviceChanged ? ` failover_from=${orderedService.provider_service_id}` : '')
        );

        try {
            await prisma.order.update({
                where: { id: hanorkOrderId },
                data: { status: 'DELIVERED' },
            });
        } catch (e) {
            logger.warn('[SMM:fulfill] order status update', { detail: e.message });
        }

        await notifyOrderSent(bot, {
            orderId: hanorkOrderId,
            smmOrderId: smmOrder.id,
            svc: usedService,
            quantity: smmOrder.quantity,
            total: smmOrder.sale_price,
            telegramId: smmOrder.telegram_id,
        });

        logger.info('[SMM:fulfill] OK', {
            hanorkOrderId,
            providerOrderId,
            providerServiceId: usedService.provider_service_id,
            failover: serviceChanged,
        });
        await runPostFulfillBenefits(hanorkOrderId, bot);
        return {
            ok: true,
            providerOrderId,
            usedServiceId: usedService.id,
            failover: serviceChanged,
        };
    },

    async _failAndNotify({ reason, hanorkOrderId, smmOrder, service, detail, guard, bot }) {
        const { applyFailureCredit } = require('./smmFailureRecoveryService');
        const { notifyOrderBlockedForBalance } = require('./providerBalanceService');

        await applyFailureCredit({
            hanorkOrderId,
            smmOrder,
            reason,
            detail,
            service,
            bot,
            markFailed: true,
        });

        if (reason === 'insufficient_provider_balance' && guard?.balance != null) {
            await notifyOrderBlockedForBalance(bot, {
                hanorkOrderId,
                balance: guard.balance,
                required: guard.required,
                smmOrder,
            });
        }
    },

    async _notifyUser(bot, telegramId, html, keyboard = null) {
        return sendUserNotification(bot, telegramId, html, keyboard, 'orders');
    },

    resolveFulfillCandidates,
};

module.exports = SmmFulfillmentService;
