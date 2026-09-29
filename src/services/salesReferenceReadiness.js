'use strict';

const { isSmmHanorkOrder } = require('../modules/smm/helpers/smmPendingHelper');
const { isVirtuoHanorkOrder } = require('../modules/virtuo/helpers/virtuoPendingHelper');
const VirtuoOrderRepository = require('../modules/virtuo/repositories/virtuoOrderRepository');
const SmmOrderRepository = require('../modules/smm/repositories/smmOrderRepository');
const { ORDER_STATUS: VIRTUO_STATUS } = require('../modules/virtuo/constants/orderStatuses');
const { ORDER_STATUS: SMM_STATUS } = require('../modules/smm/constants/orderStatuses');

function resolveSaleKind(orderId, eventData = {}) {
    if (eventData.orderKind === 'virtuo' || isVirtuoHanorkOrder(orderId)) return 'virtuo';
    if (eventData.orderKind === 'smm' || isSmmHanorkOrder(orderId)) return 'smm';
    if (eventData.orderKind === 'wa_div') return 'wa_div';
    return 'product';
}

/** Virtuo/SMM: nunca publicar no canal só com pagamento — só após fulfill confirmado. */
function requiresFulfillmentBeforePost(orderId, eventData = {}) {
    const kind = resolveSaleKind(orderId, eventData);
    return kind === 'virtuo' || kind === 'smm';
}

function checkReadyForPublicPost(db, orderId, eventData = {}) {
    const kind = resolveSaleKind(orderId, eventData);
    const inactive = new Set(['REFUNDED', 'FAILED', 'CANCELLED']);

    if (kind === 'virtuo') {
        const vo = VirtuoOrderRepository.findByHanorkOrderId(orderId);
        if (!vo) return { ready: false, reason: 'virtuo_order_missing', kind };
        if (vo.status === VIRTUO_STATUS.FAILED || vo.status === VIRTUO_STATUS.CANCELLED) {
            return { ready: false, reason: 'virtuo_failed', kind };
        }
        if (!vo.phone || !vo.virtuo_order_id) {
            return { ready: false, reason: 'virtuo_no_phone', kind };
        }
        // §0 — canal público só após entrega real (código SMS no PV), não só número reservado na API
        if (vo.status !== VIRTUO_STATUS.COMPLETED || !vo.sms_code) {
            return { ready: false, reason: 'virtuo_sms_pending', kind, status: vo.status };
        }
        return { ready: true, kind };
    }

    if (kind === 'smm') {
        const sm = SmmOrderRepository.findByHanorkOrderId(orderId);
        if (!sm) return { ready: false, reason: 'smm_order_missing', kind };
        if (sm.status === SMM_STATUS.FAILED || sm.status === SMM_STATUS.CANCELED) {
            return { ready: false, reason: 'smm_failed', kind };
        }
        if (!sm.provider_order_id) {
            return { ready: false, reason: 'smm_not_submitted', kind };
        }
        return { ready: true, kind };
    }

    const order = db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId);
    if (!order) return { ready: false, reason: 'order_not_found', kind };
    if (inactive.has(order.status)) {
        return { ready: false, reason: 'order_not_active', kind, status: order.status };
    }
    return { ready: true, kind };
}

async function emitOrderFulfillmentReady(orderId, extra = {}) {
    const { eventBus, DomainEvents } = require('../infrastructure');
    const db = require('../config/database-sqlite').connect();
    const readiness = checkReadyForPublicPost(db, orderId, extra);
    if (!readiness.ready) {
        return { emitted: false, reason: readiness.reason };
    }
    await eventBus.emit(DomainEvents.ORDER_FULFILLMENT_READY, { orderId, ...extra });
    return { emitted: true };
}

module.exports = {
    resolveSaleKind,
    requiresFulfillmentBeforePost,
    checkReadyForPublicPost,
    emitOrderFulfillmentReady,
};
