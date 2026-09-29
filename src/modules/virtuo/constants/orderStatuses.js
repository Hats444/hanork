'use strict';

const ORDER_STATUS = Object.freeze({
    AWAITING_PAYMENT: 'awaiting_payment',
    PAID: 'paid',
    WAITING_SMS: 'waiting_sms',
    COMPLETED: 'completed',
    FAILED: 'failed',
    CANCELLED: 'cancelled',
});

const POLL_STATUSES = [ORDER_STATUS.WAITING_SMS];

const PROVIDER_TERMINAL = new Set(['SUCCESS', 'CANCELLED', 'ERROR', 'FAILED']);

module.exports = { ORDER_STATUS, POLL_STATUSES, PROVIDER_TERMINAL };
