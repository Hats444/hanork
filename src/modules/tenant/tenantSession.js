'use strict';

const TTL_SEC = 60 * 60 * 24 * 90;
const TTL_MS = TTL_SEC * 1000;

function key(telegramId) {
    return `tenant_active:${telegramId}`;
}

function customerKey(telegramId) {
    return `tenant_customer:${telegramId}`;
}

async function getActiveTenantId(telegramId, stateManager) {
    if (!stateManager || !telegramId) return null;
    const row = await stateManager.get(key(telegramId));
    const id = row?.tenantId ?? row?.tenant_id;
    return id != null ? Number(id) : null;
}

async function setActiveTenantId(telegramId, tenantId, stateManager) {
    if (!stateManager || !telegramId) return;
    await stateManager.set(key(telegramId), { tenantId: Number(tenantId), _ts: Date.now() }, TTL_MS);
}

async function getCustomerTenantId(telegramId, stateManager) {
    if (!stateManager || !telegramId) return null;
    const row = await stateManager.get(customerKey(telegramId));
    const id = row?.tenantId ?? row?.tenant_id;
    return id != null ? Number(id) : null;
}

async function setCustomerTenantId(telegramId, tenantId, stateManager) {
    if (!stateManager || !telegramId) return;
    await stateManager.set(customerKey(telegramId), { tenantId: Number(tenantId), _ts: Date.now() }, TTL_MS);
}

module.exports = {
    getActiveTenantId,
    setActiveTenantId,
    getCustomerTenantId,
    setCustomerTenantId,
};
