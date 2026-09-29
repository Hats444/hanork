'use strict';

const logger = require('../../../config/logger');
const { prisma } = require('../../../config/database-sqlite');
const VirtuoOrderRepository = require('../repositories/virtuoOrderRepository');
const VirtuoServiceRepository = require('../repositories/virtuoServiceRepository');
const VirtuoApiClient = require('../providers/virtuoApiClient');
const { ORDER_STATUS } = require('../constants/orderStatuses');
const { formatPhone, formatSmsCode } = require('../utils/virtuoTextFormat');
const {
    notifyPaymentApproved,
    notifyPhoneAssigned,
    notifySmsReceived,
    notifyOrderFailed,
} = require('../helpers/virtuoUserNotify');
const VirtuoBalanceService = require('./virtuoBalanceService');
const { handleTerminalFailure } = require('./virtuoFailureRecoveryService');
const { runPostFulfillBenefits } = require('./virtuoPostFulfillService');
const { assertServiceAvailable, markNoNumbers } = require('./virtuoStockService');
const dbRaw = require('../../../config/database-sqlite').connect;

const KV_USER_FAIL_PREFIX = 'virtuo_user_fail:';
const USER_FAIL_DEDUP_MS = 15 * 60 * 1000;

function formatInternationalPhone(phone) {
    const raw = String(phone || '').replace(/\D/g, '');
    if (!raw) return phone;
    if (raw.startsWith('55') && raw.length >= 12) {
        return `+${raw.slice(0, 2)} ${raw.slice(2, 4)} ${raw.slice(4, 9)}-${raw.slice(9)}`;
    }
    return `+${raw}`;
}

async function assertServiceAvailableForOrder(svc, order) {
    return assertServiceAvailable(svc, order);
}

function shouldSkipUserFailureNotify(hanorkOrderId) {
    try {
        const key = `${KV_USER_FAIL_PREFIX}${hanorkOrderId}`;
        const row = dbRaw().prepare('SELECT value FROM kv_store WHERE key = ?').get(key);
        if (!row) return false;
        return Date.now() - Number(row.value) < USER_FAIL_DEDUP_MS;
    } catch {
        return false;
    }
}

function markUserFailureNotified(hanorkOrderId) {
    try {
        dbRaw()
            .prepare('INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, datetime(\'now\'))')
            .run(`${KV_USER_FAIL_PREFIX}${hanorkOrderId}`, String(Date.now()));
    } catch {
        /* ignore */
    }
}

const VirtuoFulfillmentService = {
    async fulfillHanorkOrder(hanorkOrderId, bot, opts = {}) {
        const order = VirtuoOrderRepository.findByHanorkOrderId(hanorkOrderId);
        if (!order) {
            return { ok: false, reason: 'virtuo_order_not_found' };
        }
        if (order.phone && order.virtuo_order_id) {
            return { ok: true, reason: 'already_submitted', phone: order.phone };
        }

        const retryable = new Set([
            'awaiting_payment',
            'paid',
            ORDER_STATUS.AWAITING_PAYMENT,
            ORDER_STATUS.PAID,
        ]);
        if (opts.forceRetry) retryable.add(ORDER_STATUS.FAILED);

        if (!retryable.has(order.status)) {
            if (order.status === ORDER_STATUS.WAITING_SMS || order.status === ORDER_STATUS.COMPLETED) {
                return { ok: true, reason: 'already_submitted' };
            }
            return { ok: false, reason: 'invalid_status', status: order.status };
        }

        const isRetry = order.status === ORDER_STATUS.FAILED;

        const svc = VirtuoServiceRepository.findById(order.virtuo_service_id);
        if (!svc) {
            VirtuoOrderRepository.updateStatus(order.id, ORDER_STATUS.FAILED);
            await this._failAndNotify(bot, order, 'service_not_found');
            return { ok: false, reason: 'service_not_found' };
        }

        const stock = await assertServiceAvailableForOrder(svc, order);
        if (!stock.ok) {
            VirtuoOrderRepository.updateStatus(order.id, ORDER_STATUS.FAILED, {
                provider_status: stock.reason,
            });
            await this._failAndNotify(bot, order, stock.reason, stock.detail);
            return { ok: false, reason: stock.reason };
        }

        VirtuoOrderRepository.updateStatus(order.id, ORDER_STATUS.PAID);

        if (!isRetry) {
            await notifyPaymentApproved(bot, {
                orderId: hanorkOrderId,
                virtuoOrderId: order.id,
                telegramId: order.telegram_id,
                serviceName: order.service_name,
                countryName: order.country_name,
            });
        }

        const balanceGuard = await VirtuoBalanceService.assertBalanceForCost(Number(order.cost));
        if (!balanceGuard.ok) {
            VirtuoOrderRepository.updateStatus(order.id, ORDER_STATUS.FAILED, {
                provider_status: balanceGuard.reason,
            });
            await this._failAndNotify(bot, order, balanceGuard.reason, balanceGuard.detail, balanceGuard);
            return { ok: false, reason: balanceGuard.reason, guard: balanceGuard };
        }

        const maxPrice = Number(order.cost) * 1.08;
        const activation = await VirtuoApiClient.requestActivationForCatalogRow(svc, {
            maxPrice,
            order,
        });

        if (!activation.ok) {
            const mappedReason = VirtuoBalanceService.mapActivationErrorToReason(activation.error);
            VirtuoOrderRepository.updateStatus(order.id, ORDER_STATUS.FAILED, {
                provider_status: activation.error?.code || mappedReason,
            });
            if (mappedReason === 'out_of_stock') {
                await markNoNumbers(svc);
            }
            const guard =
                mappedReason === 'insufficient_provider_balance'
                    ? { balance: balanceGuard.balance, required: Number(order.cost) }
                    : null;
            await this._failAndNotify(
                bot,
                order,
                mappedReason,
                activation.error?.message || activation.error?.code,
                guard
            );
            return { ok: false, reason: mappedReason, error: activation.error };
        }

        const data = activation.data || {};
        const virtuoId = data.id;
        const phone = data.phone;

        if (!virtuoId || !phone) {
            VirtuoOrderRepository.updateStatus(order.id, ORDER_STATUS.FAILED);
            await this._failAndNotify(bot, order, 'invalid_activation_response');
            return { ok: false, reason: 'invalid_activation_response' };
        }

        VirtuoOrderRepository.updateStatus(order.id, ORDER_STATUS.WAITING_SMS, {
            virtuo_order_id: String(virtuoId),
            phone: String(phone),
            provider_status: data.status || 'WAITING',
        });

        VirtuoServiceRepository.decrementAvailable(svc.id, 1);

        await notifyPhoneAssigned(bot, {
            orderId: hanorkOrderId,
            virtuoOrderId: order.id,
            telegramId: order.telegram_id,
            phone: formatInternationalPhone(phone),
            serviceName: order.service_name,
            countryName: order.country_name,
        });

        try {
            await prisma.order.update({
                where: { id: hanorkOrderId },
                data: { status: 'DELIVERING' },
            });
        } catch (e) {
            logger.warn('[Virtuo:fulfill] order status update', { detail: e.message });
        }

        logger.info('[Virtuo:fulfill] número atribuído', {
            hanorkOrderId,
            virtuoOrderId: virtuoId,
            phone,
        });

        return {
            ok: true,
            virtuoOrderId: virtuoId,
            phone,
            poll: true,
        };
    },

    async pollActivation(order, bot) {
        if (!order?.virtuo_order_id) return { updated: false };
        const statusResp = await VirtuoApiClient.getActivationStatus(order.virtuo_order_id);
        if (!statusResp.ok) {
            return { updated: false, error: statusResp.error?.message };
        }
        const data = statusResp.data || {};
        const providerStatus = String(data.status || '').toUpperCase();

        if (providerStatus === 'SUCCESS' && data.code) {
            VirtuoOrderRepository.updateStatus(order.id, ORDER_STATUS.COMPLETED, {
                sms_code: String(data.code),
                provider_status: providerStatus,
            });
            await VirtuoApiClient.completeActivation(order.virtuo_order_id).catch(() => {});
            await notifySmsReceived(bot, {
                orderId: order.hanork_order_id,
                virtuoOrderId: order.id,
                telegramId: order.telegram_id,
                phone: formatInternationalPhone(order.phone),
                code: formatSmsCode(data.code),
                serviceName: order.service_name,
                countryName: order.country_name,
            });
            try {
                await prisma.order.update({
                    where: { id: order.hanork_order_id },
                    data: { status: 'DELIVERED' },
                });
            } catch (e) {
                logger.warn('[Virtuo:poll] order DELIVERED update', { detail: e.message });
            }
            await runPostFulfillBenefits(order.hanork_order_id, bot);
            return { updated: true, notified: true, status: ORDER_STATUS.COMPLETED };
        }

        if (providerStatus === 'CANCELLED' || providerStatus === 'ERROR' || providerStatus === 'FAILED') {
            VirtuoOrderRepository.updateStatus(order.id, ORDER_STATUS.FAILED, {
                provider_status: providerStatus,
            });
            await this._failAndNotify(bot, order, 'order_failed', providerStatus);
            return { updated: true, notified: true, status: ORDER_STATUS.FAILED };
        }

        VirtuoOrderRepository.updateStatus(order.id, ORDER_STATUS.WAITING_SMS, {
            provider_status: providerStatus || 'WAITING',
        });
        return { updated: false, status: providerStatus };
    },

    async handleTimeout(order, bot) {
        if (!order?.virtuo_order_id) return { ok: false };
        await VirtuoApiClient.cancelActivation(order.virtuo_order_id).catch(() => null);
        VirtuoOrderRepository.updateStatus(order.id, ORDER_STATUS.FAILED, {
            provider_status: 'TIMEOUT',
        });
        await this._failAndNotify(bot, order, 'order_failed', 'TIMEOUT — SMS não recebido a tempo');
        return { ok: true };
    },

    async _failAndNotify(bot, order, reason, detail, guard = null) {
        const { payload } = await handleTerminalFailure({
            reason,
            hanorkOrderId: order.hanork_order_id,
            virtuoOrder: order,
            detail,
            bot,
            guard,
        });
        if (shouldSkipUserFailureNotify(order.hanork_order_id)) {
            logger.info('[Virtuo:fulfill] user notify dedup', { orderId: order.hanork_order_id, reason });
            return;
        }
        const sent = await notifyOrderFailed(bot, {
            orderId: order.hanork_order_id,
            telegramId: order.telegram_id,
            reason,
            detail: detail || payload.text?.replace(/<[^>]+>/g, ''),
        });
        if (sent) markUserFailureNotified(order.hanork_order_id);
    },
};

module.exports = VirtuoFulfillmentService;
