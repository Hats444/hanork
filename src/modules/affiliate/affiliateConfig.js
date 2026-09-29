'use strict';

const COMMISSION_RATE = Number(process.env.AFFILIATE_COMMISSION_RATE || '0.20');
const WITHDRAW_MIN = Number(process.env.AFFILIATE_WITHDRAW_MIN || '50');

module.exports = {
    COMMISSION_RATE: Number.isFinite(COMMISSION_RATE) && COMMISSION_RATE > 0 && COMMISSION_RATE <= 1
        ? COMMISSION_RATE
        : 0.20,
    WITHDRAW_MIN: Number.isFinite(WITHDRAW_MIN) && WITHDRAW_MIN > 0 ? WITHDRAW_MIN : 50,
    CODE_PREFIX: 'AFF',
};
