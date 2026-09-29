'use strict';

const VirtuoConfig = require('../virtuoConfig');
const { MP_MIN_PAYMENT_BRL, meetsMpMinPayment } = require('../../smm/services/pricingService');

function computeSalePrice(costPrice) {
    const cost = Number(costPrice);
    if (!Number.isFinite(cost) || cost < 0) return 0;
    const margin = VirtuoConfig.marginPercent / 100;
    const minProfit = VirtuoConfig.minProfit;
    return Math.max(cost + minProfit, cost * (1 + margin));
}

function computeProfit(saleTotal, costTotal) {
    return Math.max(0, Number(saleTotal) - Number(costTotal));
}

function normalizeCostFromApi(price) {
    const n = Number(price);
    if (!Number.isFinite(n) || n <= 0) return 0;
    if (n >= 100 && Number.isInteger(n)) return n / 100;
    return n;
}

function isViableForSale(salePrice) {
    return meetsMpMinPayment(salePrice);
}

module.exports = {
    computeSalePrice,
    computeProfit,
    normalizeCostFromApi,
    isViableForSale,
    MP_MIN_PAYMENT_BRL,
};
