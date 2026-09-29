'use strict';

const { getPrisma } = require('./smmPrismaAccess');

const SmmOrderRepository = {
    create(row) {
        return getPrisma().smmOrder.create(row);
    },
    updateStatus(id, status, extra) {
        return getPrisma().smmOrder.updateStatus(id, status, extra);
    },
    findById(id) {
        return getPrisma().smmOrder.findById(id);
    },
    findByHanorkOrderId(hanorkOrderId) {
        return getPrisma().smmOrder.findByHanorkOrderId(hanorkOrderId);
    },
    listByStatus(statuses, limit) {
        return getPrisma().smmOrder.listByStatus(statuses, limit);
    },
    listByTelegram(telegramId, limit) {
        return getPrisma().smmOrder.listByTelegram(telegramId, limit);
    },
    findRecentDuplicate(telegramId, serviceId, link, quantity, withinMinutes) {
        return getPrisma().smmOrder.findRecentDuplicate(telegramId, serviceId, link, quantity, withinMinutes);
    },
    listRefillPending(limit) {
        return getPrisma().smmOrder.listRefillPending(limit);
    },
    stats() {
        return getPrisma().smmOrder.stats();
    },
};

module.exports = SmmOrderRepository;
