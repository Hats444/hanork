'use strict';

const ProviderManager = require('../providers/ProviderManager');
const SmmOrderRepository = require('../repositories/smmOrderRepository');
const SmmOrderEventsRepository = require('../repositories/smmOrderEventsRepository');
const SmmServiceRepository = require('../repositories/smmServiceRepository');
const { canRequestCancel } = require('../validators/smmActionValidator');
const { ORDER_STATUS } = require('../constants/orderStatuses');
const logger = require('../../../config/logger');

function providerAccepted(raw) {
    if (!raw || raw.error) return false;
    if (Array.isArray(raw)) return raw.some((r) => r?.cancel === 1 || r?.cancel === '1' || r?.status === 'Canceled');
    return raw.cancel === 1 || raw.cancel === '1' || raw.status === 'Canceled' || raw.success === true;
}

const SmmCancelService = {
    async requestCancel(smmOrder, service) {
        const check = canRequestCancel(smmOrder, service);
        if (!check.ok) return check;

        const provider = ProviderManager.getProviderForOrder(smmOrder);
        if (!provider?.cancelOrder) return { ok: false, error: 'provider_sem_cancel' };

        SmmOrderEventsRepository.record(smmOrder.id, 'cancel_request', smmOrder.provider_order_id);

        const raw = await provider.cancelOrder(smmOrder.provider_order_id);
        if (!providerAccepted(raw)) {
            SmmOrderEventsRepository.record(smmOrder.id, 'cancel_denied', String(raw?.message || raw).slice(0, 200));
            return { ok: false, error: 'provider_rejected', raw };
        }

        SmmOrderRepository.updateStatus(smmOrder.id, ORDER_STATUS.CANCELED);
        SmmOrderEventsRepository.record(smmOrder.id, 'cancel_done', smmOrder.provider_order_id);
        logger.info('[SMM:cancel] OK', { orderId: smmOrder.id, providerOrderId: smmOrder.provider_order_id });
        return { ok: true, raw };
    },

    async cancelForUser(smmOrderId, telegramId) {
        const order = SmmOrderRepository.findById(smmOrderId);
        if (!order) return { ok: false, error: 'order_not_found' };
        if (String(order.telegram_id) !== String(telegramId)) return { ok: false, error: 'not_owner' };

        const service = SmmServiceRepository.findById(order.service_id);
        return this.requestCancel(order, service);
    },
};

module.exports = SmmCancelService;
