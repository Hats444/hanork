/**
 * DashboardService — métricas do painel admin (com filtro SaaS por loja)
 */
'use strict';

const dbRaw = require('../../config/database-sqlite').connect;
const logger = require('../../config/logger');
const { clause, cacheKey } = require('./dashboardTenant');
const { parseDashboardTenant } = require('./dashboardTenant');

const DEFAULT_SCOPE = { mode: 'legacy', tenantId: null, label: 'Loja principal' };

class DashboardService {
    constructor() {
        this.cache = new Map();
        this.cacheTTL = 30000;
    }

    getDb() {
        return dbRaw();
    }

    _scope(scope) {
        return scope || DEFAULT_SCOPE;
    }

    _getCached(key, fn) {
        const cached = this.cache.get(key);
        if (cached && Date.now() - cached.ts < this.cacheTTL) {
            return cached.data;
        }
        const data = fn();
        this.cache.set(key, { data, ts: Date.now() });
        return data;
    }

    getKPIs(scope = DEFAULT_SCOPE) {
        const s = this._scope(scope);
        return this._getCached(cacheKey('kpis', s), () => {
            const db = this.getDb();
            const today = new Date().toISOString().slice(0, 10);
            const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
            const month = today.slice(0, 7);
            const ot = clause('tenant_id', s, 'o');
            const pt = clause('tenant_id', s, 'p');
            const ut = clause('tenant_id', s, 'u');

            const revToday = db
                .prepare(
                    `SELECT COALESCE(SUM(o.total),0) as v FROM orders o WHERE o.status IN ('PAID','DELIVERED') AND date(o.created_at)=?${ot.sql}`
                )
                .get(today, ...ot.params)?.v || 0;
            const revYesterday = db
                .prepare(
                    `SELECT COALESCE(SUM(o.total),0) as v FROM orders o WHERE o.status IN ('PAID','DELIVERED') AND date(o.created_at)=?${ot.sql}`
                )
                .get(yesterday, ...ot.params)?.v || 0;
            const revWeek = db
                .prepare(
                    `SELECT COALESCE(SUM(o.total),0) as v FROM orders o WHERE o.status IN ('PAID','DELIVERED') AND o.created_at >= datetime('now', '-7 days')${ot.sql}`
                )
                .get(...ot.params)?.v || 0;
            const revMonth = db
                .prepare(
                    `SELECT COALESCE(SUM(o.total),0) as v FROM orders o WHERE o.status IN ('PAID','DELIVERED') AND substr(o.created_at,1,7)=?${ot.sql}`
                )
                .get(month, ...ot.params)?.v || 0;

            return {
                scope: s,
                revenue: {
                    today: revToday,
                    yesterday: revYesterday,
                    week: revWeek,
                    month: revMonth,
                },
                orders: {
                    today: db
                        .prepare(
                            `SELECT COUNT(*) as c FROM orders o WHERE o.status IN ('PAID','DELIVERED') AND date(o.created_at)=?${ot.sql}`
                        )
                        .get(today, ...ot.params)?.c || 0,
                    pending: db
                        .prepare(`SELECT COUNT(*) as c FROM orders o WHERE o.status='WAITING_PAYMENT'${ot.sql}`)
                        .get(...ot.params)?.c || 0,
                    failed: db
                        .prepare(
                            `SELECT COUNT(*) as c FROM orders o WHERE o.status='FAILED' AND date(o.created_at)=?${ot.sql}`
                        )
                        .get(today, ...ot.params)?.c || 0,
                },
                users: {
                    total: db.prepare(`SELECT COUNT(*) as c FROM users u WHERE 1=1${ut.sql}`).get(...ut.params)?.c || 0,
                    today: db
                        .prepare(`SELECT COUNT(*) as c FROM users u WHERE date(u.created_at)=?${ut.sql}`)
                        .get(today, ...ut.params)?.c || 0,
                    active_today: db
                        .prepare(
                            `SELECT COUNT(DISTINCT o.user_id) as c FROM orders o WHERE date(o.created_at)=?${ot.sql}`
                        )
                        .get(today, ...ot.params)?.c || 0,
                },
                products: {
                    total: db.prepare(`SELECT COUNT(*) as c FROM products p WHERE 1=1${pt.sql}`).get(...pt.params)?.c || 0,
                    active: db
                        .prepare(`SELECT COUNT(*) as c FROM products p WHERE p.active=1${pt.sql}`)
                        .get(...pt.params)?.c || 0,
                    low_stock: db
                        .prepare(
                            `SELECT COUNT(*) as c FROM products p WHERE p.stock <= 5 AND p.stock > 0 AND p.active=1${pt.sql}`
                        )
                        .get(...pt.params)?.c || 0,
                },
            };
        });
    }

    getSalesChart(days = 7, scope = DEFAULT_SCOPE) {
        const s = this._scope(scope);
        const db = this.getDb();
        const ot = clause('tenant_id', s, 'o');
        const data = [];

        for (let i = days - 1; i >= 0; i--) {
            const date = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
            const dayData = db
                .prepare(
                    `SELECT COUNT(*) as orders, COALESCE(SUM(o.total),0) as revenue, COUNT(DISTINCT o.user_id) as customers
                     FROM orders o WHERE o.status IN ('PAID','DELIVERED') AND date(o.created_at)=?${ot.sql}`
                )
                .get(date, ...ot.params);
            data.push({
                date,
                orders: dayData?.orders || 0,
                revenue: dayData?.revenue || 0,
                customers: dayData?.customers || 0,
            });
        }
        return data;
    }

    getTopProducts(limit = 10, scope = DEFAULT_SCOPE) {
        const s = this._scope(scope);
        const db = this.getDb();
        const ot = clause('tenant_id', s, 'o');
        const pt = clause('tenant_id', s, 'p');
        return db
            .prepare(
                `SELECT p.id, p.name, p.price, COUNT(oi.id) as sales_count, SUM(oi.quantity) as units_sold,
                        SUM(oi.price * oi.quantity) as revenue
                 FROM products p
                 JOIN order_items oi ON oi.product_id = p.id
                 JOIN orders o ON o.id = oi.order_id
                 WHERE o.status IN ('PAID','DELIVERED')${ot.sql}${pt.sql}
                 GROUP BY p.id ORDER BY revenue DESC LIMIT ?`
            )
            .all(...ot.params, ...pt.params, limit);
    }

    getRecentOrders(limit = 20, scope = DEFAULT_SCOPE) {
        const s = this._scope(scope);
        const db = this.getDb();
        const ot = clause('tenant_id', s, 'o');
        return db
            .prepare(
                `SELECT o.id, o.total, o.status, o.created_at, o.tenant_id, u.first_name, u.username, u.telegram_id
                 FROM orders o JOIN users u ON u.id = o.user_id
                 WHERE 1=1${ot.sql} ORDER BY o.created_at DESC LIMIT ?`
            )
            .all(...ot.params, limit);
    }

    getFunnel(scope = DEFAULT_SCOPE) {
        const s = this._scope(scope);
        const db = this.getDb();
        const today = new Date().toISOString().slice(0, 10);
        const ot = clause('tenant_id', s, 'o');
        const ut = clause('tenant_id', s, 'u');
        return {
            users_total: db.prepare(`SELECT COUNT(*) as c FROM users u WHERE 1=1${ut.sql}`).get(...ut.params)?.c || 0,
            users_today: db
                .prepare(`SELECT COUNT(*) as c FROM users u WHERE date(u.created_at)=?${ut.sql}`)
                .get(today, ...ut.params)?.c || 0,
            orders_created: db
                .prepare(`SELECT COUNT(*) as c FROM orders o WHERE date(o.created_at)=?${ot.sql}`)
                .get(today, ...ot.params)?.c || 0,
            orders_paid: db
                .prepare(
                    `SELECT COUNT(*) as c FROM orders o WHERE o.status IN ('PAID','DELIVERED') AND date(o.created_at)=?${ot.sql}`
                )
                .get(today, ...ot.params)?.c || 0,
            conversion_rate: 0,
        };
    }

    getContext() {
        const TenantService = require('../tenant/TenantService');
        const tenants = TenantService.getAll({ page: 1, limit: 100 }).rows.map((t) => ({
            id: t.id,
            name: t.name,
            slug: t.slug,
            plan: t.plan,
            active: t.active !== 0,
        }));
        const siteBase = (process.env.SITE_HANORK || '').replace(/\/$/, '');
        return {
            tenants,
            siteBase,
            scopes: [
                { id: 'legacy', label: 'Loja principal (legado)' },
                { id: 'all', label: 'Todas as lojas' },
            ],
        };
    }

    clearCache() {
        this.cache.clear();
        logger.info('[DASHBOARD] Cache limpo');
    }
}

const instance = new DashboardService();
instance.parseScope = parseDashboardTenant;
module.exports = instance;
