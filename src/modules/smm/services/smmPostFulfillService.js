'use strict';

const logger = require('../../../config/logger');
const { prisma } = require('../../../config/database-sqlite');
const AffiliateCommissionService = require('../../../services/AffiliateCommissionService');
const SafeDeliveryService = require('../../delivery/SafeDeliveryService');

async function runPostFulfillBenefits(hanorkOrderId, bot) {
    try {
        const order = await prisma.order.findUnique({ where: { id: hanorkOrderId } });
        if (!order?.user_id) return;

        const total = Number(order.total) || 0;
        const telegram = bot?.telegram || null;

        await SafeDeliveryService._createCashback(order.user_id, hanorkOrderId, total);
        await AffiliateCommissionService.payCommission({
            buyerUserId: order.user_id,
            orderId: hanorkOrderId,
            total,
            telegram,
            tenantId: order.tenant_id || 'default',
        });

        logger.info('[SMM:postFulfill] benefícios aplicados', { orderId: hanorkOrderId });
    } catch (e) {
        logger.warn('[SMM:postFulfill] falhou (não crítico)', { orderId: hanorkOrderId, detail: e.message });
    }
}

module.exports = { runPostFulfillBenefits };
