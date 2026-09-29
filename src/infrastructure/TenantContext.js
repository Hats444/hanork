/**
 * TenantContext - Isolamento multi-tenant (AsyncLocalStorage)
 */
'use strict';

const { AsyncLocalStorage } = require('async_hooks');
const logger = require('../config/logger');
const { legacyTenant, platformTenant, normalizeRow } = require('../modules/tenant/tenantResolver');

class TenantContext {
    constructor() {
        this.storage = new AsyncLocalStorage();
        this.defaultTenant = legacyTenant();
    }

    middleware(resolveFn) {
        return async (ctx, next) => {
            const tenant = (await resolveFn(ctx)) || this.defaultTenant;
            return this.storage.run(tenant, async () => {
                ctx.tenant = tenant;
                return next();
            });
        };
    }

    async findById(id) {
        if (!id || id === 'legacy' || id === 'default') return legacyTenant();
        if (id === 'platform') return platformTenant();
        const TenantService = require('../modules/tenant/TenantService');
        const row = TenantService.getById(id);
        return row ? normalizeRow(row) : null;
    }

    async findByOwner(telegramId) {
        const TenantService = require('../modules/tenant/TenantService');
        const rows = TenantService.getByOwner(telegramId);
        const active = rows.find((r) => r.active);
        return active ? normalizeRow(active) : null;
    }

    isValid(tenant) {
        if (!tenant) return false;
        if (tenant.mode === 'legacy' || tenant.mode === 'platform') return true;
        if (tenant.active === false) return false;
        if (tenant.plan_expires_at) {
            const expires = new Date(tenant.plan_expires_at);
            if (expires < new Date()) return false;
        }
        return true;
    }

    getCurrent() {
        return this.storage.getStore() || this.defaultTenant;
    }

    getCurrentId() {
        const tenant = this.getCurrent();
        if (tenant?.mode === 'tenant' && tenant.id != null) return Number(tenant.id);
        return null;
    }

    getCurrentNumericId() {
        return this.getCurrentId();
    }

    isAdmin(userId) {
        const tenant = this.getCurrent();
        if (!tenant || tenant.mode !== 'tenant') return false;
        return String(tenant.owner_telegram_id) === String(userId);
    }

    hasFeature(feature) {
        const tenant = this.getCurrent();
        if (!tenant || tenant.mode !== 'tenant') return true;
        const TenantService = require('../modules/tenant/TenantService');
        return TenantService.canUseFeature(tenant.id, feature);
    }

    async runAs(tenantId, fn) {
        const tenant = await this.findById(tenantId);
        if (!tenant) throw new Error(`Tenant not found: ${tenantId}`);
        return this.storage.run(tenant, fn);
    }

    cacheKey(key) {
        const id = this.getCurrentId() ?? 'legacy';
        return `tenant:${id}:${key}`;
    }

    sanitize(data) {
        if (!data || typeof data !== 'object') return data;
        const sensitive = ['token_telegram', 'token_mp', 'mp_webhook_secret', 'jwt_secret'];
        const sanitized = { ...data };
        for (const field of sensitive) delete sanitized[field];
        return sanitized;
    }

    log(message, meta = {}) {
        const tenant = this.getCurrent();
        logger.info(`[TENANT:${tenant?.id ?? 'legacy'}] ${message}`, {
            tenantId: tenant?.id,
            tenantMode: tenant?.mode,
            ...meta,
        });
    }
}

const tenantContext = new TenantContext();

module.exports = tenantContext;
module.exports.default = tenantContext;

module.exports.withTenant = (baseQuery) => {
    const tenantId = tenantContext.getCurrentId();
    if (tenantId == null) {
        return baseQuery.includes('WHERE')
            ? `${baseQuery} AND tenant_id IS NULL`
            : `${baseQuery} WHERE tenant_id IS NULL`;
    }
    return baseQuery.includes('WHERE')
        ? `${baseQuery} AND tenant_id = ?`
        : `${baseQuery} WHERE tenant_id = ?`;
};
