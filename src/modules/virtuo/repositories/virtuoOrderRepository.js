'use strict';

const { getPrisma } = require('../../smm/repositories/smmPrismaAccess');

const VirtuoOrderRepository = {
    create(row) {
        return getPrisma().virtuoOrder.create(row);
    },
    updateStatus(id, status, extra = {}) {
        return getPrisma().virtuoOrder.updateStatus(id, status, extra);
    },
    findById(id) {
        return getPrisma().virtuoOrder.findById(id);
    },
    findByHanorkOrderId(hanorkOrderId) {
        return getPrisma().virtuoOrder.findByHanorkOrderId(hanorkOrderId);
    },
    listByStatus(statuses, limit) {
        return getPrisma().virtuoOrder.listByStatus(statuses, limit);
    },
    listByTelegram(telegramId, limit) {
        return getPrisma().virtuoOrder.listByTelegram(telegramId, limit);
    },
    findPendingByTelegram(telegramId) {
        return getPrisma().virtuoOrder.findPendingByTelegram(telegramId);
    },
    stats() {
        return getPrisma().virtuoOrder.stats();
    },
};

module.exports = VirtuoOrderRepository;
