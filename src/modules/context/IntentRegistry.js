'use strict';

const payment = require('./intents/payment.intent');
const service = require('./intents/service.intent');
const appointment = require('./intents/appointment.intent');
const debt = require('./intents/debt.intent');
const reminder = require('./intents/reminder.intent');
const negotiation = require('./intents/negotiation.intent');

const BY_TYPE = new Map([
    [payment.type, payment],
    [service.type, service],
    [appointment.type, appointment],
    [debt.type, debt],
    [reminder.type, reminder],
    [negotiation.type, negotiation],
]);

function get(type) {
    return BY_TYPE.get(type) || null;
}

function all() {
    return [...BY_TYPE.values()];
}

module.exports = { get, all };
