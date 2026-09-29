'use strict';

const SmmConfig = require('../smmConfig');
const { isFlatRatePricing } = require('../constants/serviceTypes');

/**
 * rate do fornecedor = preço por 1000 unidades (padrão painéis SMM).
 * cost_price armazenado = rate por 1000.
 */
function computeSalePrice(costPrice) {
    const cost = Number(costPrice);
    if (!Number.isFinite(cost) || cost < 0) return 0;
    const margin = SmmConfig.marginPercent / 100;
    const minProfit = SmmConfig.minProfit;
    const withMargin = cost * (1 + margin);
    const withMin = cost + minProfit;
    return Math.max(withMin, withMargin);
}

function computeOrderTotal(salePricePer1000, quantity, serviceType = 'Default') {
    const rate = Number(salePricePer1000);
    const qty = Number(quantity);
    if (!Number.isFinite(rate) || !Number.isFinite(qty) || qty <= 0) return 0;
    if (isFlatRatePricing(serviceType)) {
        return rate * qty;
    }
    return (rate / 1000) * qty;
}

function computeOrderCost(costPricePer1000, quantity, serviceType = 'Default') {
    const rate = Number(costPricePer1000);
    const qty = Number(quantity);
    if (!Number.isFinite(rate) || !Number.isFinite(qty) || qty <= 0) return 0;
    if (isFlatRatePricing(serviceType)) {
        return rate * qty;
    }
    return (rate / 1000) * qty;
}

function computeProfit(saleTotal, costTotal) {
    return Math.max(0, Number(saleTotal) - Number(costTotal));
}

/** Mínimo exigido pelo Mercado Pago (PIX/cartão). */
const MP_MIN_PAYMENT_BRL = 0.5;

function minQuantityForMpPayment(salePricePer1000, minAmount = MP_MIN_PAYMENT_BRL) {
    const rate = Number(salePricePer1000);
    if (!Number.isFinite(rate) || rate <= 0) return Infinity;
    return Math.ceil((minAmount * 1000) / rate);
}

function effectiveMinQuantity(service, minAmount = MP_MIN_PAYMENT_BRL) {
    const svcMin = Math.max(1, Number(service?.min_quantity) || 1);
    if (isFlatRatePricing(service?.service_type)) {
        const flatTotal = computeOrderTotal(service?.sale_price, svcMin, service?.service_type);
        if (meetsMpMinPayment(flatTotal, minAmount)) return svcMin;
        return Infinity;
    }
    const payMin = minQuantityForMpPayment(service?.sale_price, minAmount);
    return Math.max(svcMin, payMin);
}

function meetsMpMinPayment(saleTotal, minAmount = MP_MIN_PAYMENT_BRL) {
    const n = Number(saleTotal);
    return Number.isFinite(n) && n >= minAmount;
}

module.exports = {
    computeSalePrice,
    computeOrderTotal,
    computeOrderCost,
    computeProfit,
    MP_MIN_PAYMENT_BRL,
    minQuantityForMpPayment,
    effectiveMinQuantity,
    meetsMpMinPayment,
};
