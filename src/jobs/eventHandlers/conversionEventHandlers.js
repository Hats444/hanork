'use strict';

const { DomainEvents } = require('../../infrastructure');
const { trackConversionEvent } = require('../../services/ConversionEventService');

/**
 * Eventos de conversão pós-pagamento / entrega (assíncronos, não bloqueiam fluxo).
 */
function registerConversionEventHandlers(eventBus, { logger }) {
    eventBus.on(DomainEvents.ORDER_PAID, async ({ orderId, userId, tenantId }) => {
        try {
            trackConversionEvent(userId, 'payment_approved', { orderId }, tenantId);
        } catch (e) {
            logger.debug('[CONVERSION] payment_approved:', e.message);
        }
    });
}

module.exports = { registerConversionEventHandlers };
