'use strict';

const SmmOrderRepository = require('../repositories/smmOrderRepository');

function findRecentDuplicate(telegramId, serviceId, link, quantity, withinMinutes) {
    return SmmOrderRepository.findRecentDuplicate(
        telegramId,
        serviceId,
        link,
        quantity,
        withinMinutes
    );
}

module.exports = { findRecentDuplicate };
