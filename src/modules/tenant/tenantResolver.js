'use strict';

const TenantService = require('./TenantService');
const tenantSession = require('./tenantSession');
const { isPlatformAdmin } = require('./tenantScope');

function normalizeRow(row) {
    if (!row) return null;
    return {
        ...row,
        id: Number(row.id),
        active: row.active !== 0,
        mode: 'tenant',
    };
}

function legacyTenant() {
    return { id: 'legacy', mode: 'legacy', name: 'Loja principal', plan: 'business', active: true };
}

function platformTenant() {
    return { id: 'platform', mode: 'platform', name: 'Plataforma Hanork', plan: 'enterprise', active: true };
}

/**
 * Resolve tenant para Telegram/HTTP e persiste sessão quando aplicável.
 * @param {object} ctx
 * @param {object} deps — { stateManager, prisma }
 */
async function resolveForTelegram(ctx, deps = {}) {
    const { stateManager, prisma } = deps;
    const uid = ctx.from?.id;
    if (!uid) return legacyTenant();

    const payload = (ctx.startPayload || '').trim();
    const tid = String(uid);
    const msgText = ctx.message?.text || '';
    const cb = ctx.callbackQuery?.data || '';

    if (isPlatformAdmin(uid)) {
        if (/^\/(admin|admin_saas|usuarios|userinfo|backup|broadcast)\b/.test(msgText)) {
            return legacyTenant();
        }
        if (/^(a_|admin)/.test(cb)) {
            return legacyTenant();
        }
    }

    if (payload.startsWith('loja_')) {
        const slug = payload.slice(5).split('_')[0];
        const t = TenantService.getBySlug(slug);
        if (t?.active) {
            if (stateManager) await tenantSession.setCustomerTenantId(tid, t.id, stateManager);
            return normalizeRow(t);
        }
    }

    if (stateManager) {
        const active = await tenantSession.getActiveTenantId(tid, stateManager);
        if (active) {
            const t = TenantService.getById(active);
            if (t?.active && String(t.owner_telegram_id) === tid) return normalizeRow(t);
        }

        const customerTid = await tenantSession.getCustomerTenantId(tid, stateManager);
        if (customerTid) {
            const t = TenantService.getById(customerTid);
            if (t?.active) return normalizeRow(t);
        }
    }

    const owned = TenantService.getByOwner(tid);
    if (owned.length === 1 && owned[0].active) {
        const t = owned[0];
        if (stateManager) await tenantSession.setActiveTenantId(tid, t.id, stateManager);
        return normalizeRow(t);
    }

    if (prisma) {
        try {
            const user = await prisma.user.findUnique({ where: { telegram_id: tid } });
            if (user?.tenant_id) {
                const t = TenantService.getById(user.tenant_id);
                if (t?.active) return normalizeRow(t);
            }
        } catch {
            /* ignore */
        }
    }

    if (isPlatformAdmin(uid) && !owned.length) {
        return legacyTenant();
    }

    if (owned.length > 0 && ctx.message?.text?.match(/^\/(admin_loja|addproduto|gerenciarprodutos)/)) {
        const t = owned.find((x) => x.active) || owned[0];
        if (stateManager) await tenantSession.setActiveTenantId(tid, t.id, stateManager);
        return normalizeRow(t);
    }

    return legacyTenant();
}

async function resolveForOrder(order) {
    if (!order?.tenant_id) return legacyTenant();
    const t = TenantService.getById(order.tenant_id);
    return t ? normalizeRow(t) : legacyTenant();
}

module.exports = {
    resolveForTelegram,
    resolveForOrder,
    normalizeRow,
    legacyTenant,
    platformTenant,
};
