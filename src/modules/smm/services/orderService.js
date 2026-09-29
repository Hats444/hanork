'use strict';

const SmmOrderRepository = require('../repositories/smmOrderRepository');
const SmmCancelService = require('./cancelService');
const SmmRefillService = require('./refillService');

const SmmOrderService = {
    createLocalDraft({ telegramId, service, link, quantity, hanorkOrderId = null }) {
        const { computeOrderCost, computeOrderTotal, computeProfit } = require('./pricingService');
        const { ORDER_STATUS } = require('../constants/orderStatuses');
        const cost = computeOrderCost(service.cost_price, quantity, service.service_type);
        const sale = computeOrderTotal(service.sale_price, quantity, service.service_type);
        const profit = computeProfit(sale, cost);
        return SmmOrderRepository.create({
            telegram_id: telegramId,
            hanork_order_id: hanorkOrderId,
            provider: service.provider,
            service_id: service.id,
            link,
            quantity,
            cost,
            sale_price: sale,
            profit,
            status: ORDER_STATUS.AWAITING_PAYMENT,
        });
    },

    findByHanorkOrderId(hanorkOrderId) {
        return SmmOrderRepository.findByHanorkOrderId(hanorkOrderId);
    },

    listUserOrders(telegramId, limit = 10) {
        return SmmOrderRepository.listByTelegram(telegramId, limit);
    },

    findById(id) {
        return SmmOrderRepository.findById(id);
    },

    requestRefill: (orderId, telegramId) => SmmRefillService.refillForUser(orderId, telegramId),
    requestCancel: (orderId, telegramId) => SmmCancelService.cancelForUser(orderId, telegramId),
};

module.exports = SmmOrderService;
