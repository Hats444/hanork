'use strict';

const { DomainEvents } = require('../../infrastructure');
const { createAdminSaleNotifyService } = require('../../services/AdminSaleNotifyService');

/**
 * Venda confirmada → PV dos admins (formato completo, estilo canal de referências).
 */
function registerAdminSaleNotify(eventBus, { dbRaw, logger }) {
    const service = createAdminSaleNotifyService({ dbRaw });

    eventBus.on(DomainEvents.ORDER_PAID, async (eventData) => {
        try {
            const r = await service.notifySaleConfirmed(eventData);
            if (r.ok && !r.skipped) {
                logger.debug('[ADMIN_SALE] venda notificada no PV', { orderId: eventData?.orderId });
            }
        } catch (e) {
            logger.warn('[ADMIN_SALE] handler ORDER_PAID', { detail: e.message });
        }
    });

    return service;
}

module.exports = { registerAdminSaleNotify };
