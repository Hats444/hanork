'use strict';

const { DomainEvents } = require('../../infrastructure');
const { SalesReferenceChannelService } = require('../../services/SalesReferenceChannelService');
const { isSalesRefChannelEnabled } = require('../../config/salesReferenceChannel');

/**
 * Publica vendas confirmadas (produto, SMM, saldo afiliado) em @hanorkinfos.
 */
function registerSalesReferenceChannel(eventBus, { bot, dbRaw, logger, groupService }) {
    if (!isSalesRefChannelEnabled()) {
        logger.info('[SALES_REF] desativado — SALES_REF_CHANNEL_ID=0');
        return null;
    }

    const service = new SalesReferenceChannelService({ bot, dbRaw, groupService });
    service.ensureExcludedFromAutoBroadcast();

    const channelId = service.getChannelId();
    logger.info('[SALES_REF] ativo → canal de referências', { channelId });

    eventBus.on(DomainEvents.ORDER_PAID, async (eventData) => {
        try {
            await service.postConfirmedSale(eventData);
        } catch (e) {
            logger.error('[SALES_REF] handler:', e.message);
        }
    });

    return service;
}

module.exports = { registerSalesReferenceChannel };
