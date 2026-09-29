'use strict';

const TenantService = require('./TenantService');

function formatLimitMessage(kind, check) {
    const labels = {
        products: 'produtos',
        orders: 'pedidos este mês',
        broadcasts: 'broadcasts este mês',
    };
    const label = labels[kind] || kind;
    return (
        `⚠️ <b>Limite do plano atingido</b>\n\n` +
        `Você usou <b>${check.current}/${check.max}</b> ${label}.\n\n` +
        `Use <code>/planos</code> para fazer upgrade.`
    );
}

function checkProductLimit(tenantId) {
    if (!tenantId) return { allowed: true };
    return TenantService.checkProductLimit(tenantId);
}

function checkOrderLimit(tenantId) {
    if (!tenantId) return { allowed: true };
    return TenantService.checkOrderLimit(tenantId);
}

function assertProductLimit(tenantId) {
    const c = checkProductLimit(tenantId);
    if (!c.allowed) {
        const err = new Error('PRODUCT_LIMIT');
        err.userMessage = formatLimitMessage('products', c);
        throw err;
    }
    return c;
}

function assertOrderLimit(tenantId) {
    const c = checkOrderLimit(tenantId);
    if (!c.allowed) {
        const err = new Error('ORDER_LIMIT');
        err.userMessage = formatLimitMessage('orders', c);
        throw err;
    }
    return c;
}

function assertFeature(tenantId, feature) {
    if (!tenantId) return true;
    if (!TenantService.canUseFeature(tenantId, feature)) {
        const err = new Error('FEATURE_LOCKED');
        err.userMessage =
            `🔒 Recurso não incluído no seu plano.\n\nUse <code>/planos</code> para upgrade.`;
        throw err;
    }
    return true;
}

module.exports = {
    checkProductLimit,
    checkOrderLimit,
    assertProductLimit,
    assertOrderLimit,
    assertFeature,
    formatLimitMessage,
};
