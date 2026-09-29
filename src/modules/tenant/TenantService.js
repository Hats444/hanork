/**
 * TenantService — gestão de lojistas (multi-tenancy)
 * Cada tenant é um lojista com sua própria loja, plano e configurações.
 * Por ora compartilham o mesmo banco SQLite (isolamento por tenant_id).
 * Evolução futura: banco separado por tenant.
 */
'use strict';

const logger = require('../../config/logger');
const secretCrypto = require('../security/secretCrypto');

function db() {
    return require('../../config/database-sqlite').connect();
}

const SECRET_FIELDS = ['token_mp', 'token_telegram'];

function hydrateTenant(row) {
    if (!row) return null;
    const out = { ...row };
    for (const f of SECRET_FIELDS) {
        if (out[f]) out[f] = secretCrypto.decryptField(out[f]);
    }
    return out;
}

function prepareSecretFields(fields) {
    const out = { ...fields };
    for (const f of SECRET_FIELDS) {
        if (out[f] != null && out[f] !== '') {
            out[f] = secretCrypto.encryptField(String(out[f]));
        }
    }
    return out;
}

// Slugify: "Minha Loja!" → "minha-loja"
function slugify(str) {
    return str.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s-]/g, '')
        .trim().replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .slice(0, 40);
}

class TenantService {

    // ── CRUD ───────────────────────────────────────────────────────────────────

    create({ name, owner_telegram_id, plan = 'free' }) {
        const base = slugify(name);
        let slug = base;
        let tries = 0;
        // garantir slug único
        while (this.getBySlug(slug) && tries < 10) {
            tries++;
            slug = `${base}-${tries}`;
        }
        const result = db().prepare(`
            INSERT INTO tenants (slug, name, owner_telegram_id, plan, active)
            VALUES (?, ?, ?, ?, 1)
        `).run(slug, name, String(owner_telegram_id), plan);
        logger.info(`[TENANT] Criado: ${slug} (id=${result.lastInsertRowid})`);
        return this.getById(result.lastInsertRowid);
    }

    getById(id) {
        const row = db().prepare('SELECT * FROM tenants WHERE id=?').get(Number(id)) || null;
        return hydrateTenant(row);
    }

    getBySlug(slug) {
        const row = db().prepare('SELECT * FROM tenants WHERE slug=?').get(slug) || null;
        return hydrateTenant(row);
    }

    getByOwner(telegram_id) {
        const rows = db().prepare('SELECT * FROM tenants WHERE owner_telegram_id=? AND active=1 ORDER BY id DESC').all(String(telegram_id));
        return rows.map(hydrateTenant);
    }

    getAll({ page = 1, limit = 20, active = null } = {}) {
        const offset = (page - 1) * limit;
        const where = active !== null ? 'WHERE active=?' : '';
        const params = active !== null ? [active ? 1 : 0, limit, offset] : [limit, offset];
        const rows = db().prepare(`SELECT t.*, p.label as plan_label, p.price as plan_price FROM tenants t LEFT JOIN tenant_plans p ON p.name=t.plan ${where} ORDER BY t.created_at DESC LIMIT ? OFFSET ?`).all(...params);
        const total = db().prepare(`SELECT COUNT(*) as c FROM tenants ${where}`).get(...(active !== null ? [active ? 1 : 0] : []))?.c || 0;
        return { rows: rows.map(hydrateTenant), total, page, pages: Math.ceil(total / limit) };
    }

    update(id, fields) {
        const allowed = ['name', 'plan', 'plan_expires_at', 'token_telegram', 'token_mp', 'mp_payer_email', 'onboarding_step', 'onboarding_done', 'active'];
        const prepared = prepareSecretFields(fields);
        const sets = Object.keys(prepared).filter(k => allowed.includes(k)).map(k => `${k}=?`);
        if (!sets.length) return;
        const vals = sets.map(s => prepared[s.split('=')[0]]);
        db().prepare(`UPDATE tenants SET ${sets.join(',')}, updated_at=datetime('now') WHERE id=?`).run(...vals, Number(id));
    }

    delete(id) {
        db().prepare(`UPDATE tenants SET active=0, updated_at=datetime('now') WHERE id=?`).run(Number(id));
    }

    // ── Onboarding ─────────────────────────────────────────────────────────────

    advanceOnboarding(id, step) {
        db().prepare(`UPDATE tenants SET onboarding_step=?, updated_at=datetime('now') WHERE id=?`).run(step, Number(id));
    }

    completeOnboarding(id) {
        db().prepare(`UPDATE tenants SET onboarding_done=1, onboarding_step=99, updated_at=datetime('now') WHERE id=?`).run(Number(id));
    }

    // ── Planos ─────────────────────────────────────────────────────────────────

    getPlans() {
        return db().prepare('SELECT * FROM tenant_plans ORDER BY price ASC').all();
    }

    getPlan(name) {
        return db().prepare('SELECT * FROM tenant_plans WHERE name=?').get(name) || null;
    }

    getPlanFor(tenantId) {
        const t = this.getById(tenantId);
        if (!t) return null;
        return this.getPlan(t.plan);
    }

    assignPlan(tenantId, planName, expiresAt = null) {
        db().prepare(`UPDATE tenants SET plan=?, plan_expires_at=?, updated_at=datetime('now') WHERE id=?`).run(planName, expiresAt, Number(tenantId));
        logger.info(`[TENANT] Plano atualizado: tenant=${tenantId} plan=${planName}`);
    }

    isPlanActive(tenant) {
        if (!tenant) return false;
        if (tenant.plan === 'free') return true;
        if (!tenant.plan_expires_at) return true;
        return new Date(tenant.plan_expires_at) > new Date();
    }

    // Checa se tenant pode usar feature pelo plano
    canUseFeature(tenantId, feature) {
        const plan = this.getPlanFor(tenantId);
        if (!plan) return false;
        const featureMap = {
            affiliates: 'allow_affiliates',
            ai: 'allow_ai',
            flash_sale: 'allow_flash_sale',
            subscriptions: 'allow_subscriptions',
        };
        const col = featureMap[feature];
        if (!col) return true;
        return plan[col] === 1;
    }

    // Checa limite de produtos (respeita tenant)
    checkProductLimit(tenantId) {
        const plan = this.getPlanFor(tenantId);
        if (!plan) return { allowed: false, current: 0, max: 0 };
        const count = db().prepare('SELECT COUNT(*) as c FROM products WHERE active=1 AND tenant_id=?').get(tenantId)?.c || 0;
        return { allowed: count < plan.max_products, current: count, max: plan.max_products };
    }

    checkOrderLimit(tenantId) {
        const plan = this.getPlanFor(tenantId);
        if (!plan) return { allowed: false, current: 0, max: 0 };
        const month = new Date().toISOString().slice(0, 7);
        const count = db()
            .prepare(
                `SELECT COUNT(*) as c FROM orders WHERE status IN ('PAID','DELIVERED') AND substr(created_at,1,7)=? AND tenant_id=?`
            )
            .get(month, tenantId)?.c || 0;
        return { allowed: count < plan.max_orders_month, current: count, max: plan.max_orders_month };
    }

    checkBroadcastLimit(tenantId) {
        const plan = this.getPlanFor(tenantId);
        if (!plan) return { allowed: false, current: 0, max: 0 };
        const month = new Date().toISOString().slice(0, 7);
        const key = `bcast_count:${tenantId}:${month}`;
        let current = 0;
        try {
            const row = db().prepare('SELECT value FROM kv_store WHERE key=?').get(key);
            current = row?.value ? Number(JSON.parse(row.value)) : 0;
        } catch {
            current = 0;
        }
        return { allowed: current < plan.max_broadcasts_month, current, max: plan.max_broadcasts_month };
    }

    incrementBroadcastCount(tenantId) {
        const month = new Date().toISOString().slice(0, 7);
        const key = `bcast_count:${tenantId}:${month}`;
        const row = db().prepare('SELECT value FROM kv_store WHERE key=?').get(key);
        const n = row?.value ? Number(JSON.parse(row.value)) + 1 : 1;
        db()
            .prepare(
                `INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, datetime('now'))`
            )
            .run(key, String(n));
    }

    // ── Stats por tenant ───────────────────────────────────────────────────────

    getStats(tenantId) {
        const d = db();
        const today = new Date().toISOString().slice(0, 10);
        const month = new Date().toISOString().slice(0, 7);
        return {
            revenue_today: d.prepare(`SELECT COALESCE(SUM(total),0) as v FROM orders WHERE status IN ('PAID','DELIVERED') AND date(created_at)=? AND tenant_id=?`).get(today, tenantId)?.v || 0,
            revenue_month: d.prepare(`SELECT COALESCE(SUM(total),0) as v FROM orders WHERE status IN ('PAID','DELIVERED') AND substr(created_at,1,7)=? AND tenant_id=?`).get(month, tenantId)?.v || 0,
            orders_month: d.prepare(`SELECT COUNT(*) as c FROM orders WHERE status IN ('PAID','DELIVERED') AND substr(created_at,1,7)=? AND tenant_id=?`).get(month, tenantId)?.c || 0,
            users_total: d.prepare('SELECT COUNT(*) as c FROM users WHERE tenant_id=?').get(tenantId)?.c || 0,
        };
    }

    // ── Tenant Isolation Helper ───────────────────────────────────────────────

    /**
     * Atualiza tenant_id de registros existentes (migration helper)
     * Usado para migrar dados antigos (single-tenant) para multi-tenant
     */
    migrateDataToTenant(tenantId, ownerTelegramId) {
        const d = db();
        try {
            // Atualizar todos os registros do dono para o tenant
            d.prepare(`UPDATE users SET tenant_id=? WHERE telegram_id=?`).run(tenantId, ownerTelegramId);
            d.prepare(`UPDATE products SET tenant_id=? WHERE tenant_id IS NULL`).run(tenantId);
            d.prepare(`UPDATE orders SET tenant_id=? WHERE tenant_id IS NULL`).run(tenantId);
            d.prepare(`UPDATE order_items SET tenant_id=? WHERE tenant_id IS NULL`).run(tenantId);
            d.prepare(`UPDATE coupons SET tenant_id=? WHERE tenant_id IS NULL`).run(tenantId);
            d.prepare(`UPDATE affiliates SET tenant_id=? WHERE tenant_id IS NULL`).run(tenantId);
            d.prepare(`UPDATE favorites SET tenant_id=? WHERE tenant_id IS NULL`).run(tenantId);
            logger.info(`[TENANT] Migration completed for tenant ${tenantId}`);
        } catch (e) {
            logger.error(`[TENANT] Migration error: ${e.message}`);
        }
    }

    /**
     * Verifica se usuário tem acesso a um recurso do tenant
     */
    canAccessResource(userTelegramId, resourceType, resourceId) {
        const d = db();
        const user = d.prepare('SELECT tenant_id FROM users WHERE telegram_id=?').get(userTelegramId);
        if (!user || !user.tenant_id) return false;

        let table = resourceType;
        if (resourceType === 'order') table = 'orders';
        if (resourceType === 'product') table = 'products';
        if (resourceType === 'user') table = 'users';

        const resource = d.prepare(`SELECT tenant_id FROM ${table} WHERE id=?`).get(resourceId);
        return resource && resource.tenant_id === user.tenant_id;
    }
}

module.exports = new TenantService();
