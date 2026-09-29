'use strict';

const { connect } = require('../config/database-sqlite');
const { getScopeFromContext } = require('../modules/tenant/tenantScope');

const CACHE_TTL_MS = 90_000;
const cache = new Map();

function cacheKey(name, tenantId, days) {
    return `${name}:${tenantId ?? 'legacy'}:${days}`;
}

function getCached(key) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;
    return null;
}

function setCache(key, data) {
    cache.set(key, { at: Date.now(), data });
    if (cache.size > 40) {
        const oldest = cache.keys().next().value;
        cache.delete(oldest);
    }
}

function tenantFilter(scope) {
    if (scope?.mode === 'tenant' && scope.tenantId != null) {
        return { sql: ' AND tenant_id = ?', params: [scope.tenantId] };
    }
    if (scope?.mode === 'legacy') {
        return { sql: ' AND tenant_id IS NULL', params: [] };
    }
    return { sql: '', params: [] };
}

function eventCount(db, eventName, sinceIso, tf) {
    const row = db.prepare(
        `SELECT COUNT(DISTINCT user_id) AS c FROM conversion_events
         WHERE event_name = ? AND datetime(created_at) >= datetime(?)${tf.sql}`
    ).get(eventName, sinceIso, ...tf.params);
    return row?.c || 0;
}

function auditDistinctUsers(db, sinceIso, extraWhere = '') {
    try {
        const row = db.prepare(
            `SELECT COUNT(DISTINCT user_id) AS c FROM telegram_event_audit
             WHERE datetime(created_at) >= datetime(?)
               AND user_id IS NOT NULL AND TRIM(user_id) != ''${extraWhere}`
        ).get(sinceIso);
        return row?.c || 0;
    } catch {
        return 0;
    }
}

function legacyFunnel(db, sinceDate, sinceIso, tfUsers, tfOrders, tfCarts) {
    const users = db.prepare(
        `SELECT COUNT(*) AS c FROM users WHERE date(created_at) >= ?${tfUsers.sql}`
    ).get(sinceDate, ...tfUsers.params)?.c || 0;
    const catalog = db.prepare(
        `SELECT COUNT(DISTINCT telegram_id) AS c FROM active_carts WHERE date(added_at) >= ?${tfCarts.sql}`
    ).get(sinceDate, ...tfCarts.params)?.c || 0;
    const checkout = db.prepare(
        `SELECT COUNT(DISTINCT user_id) AS c FROM orders WHERE date(created_at) >= ?${tfOrders.sql}`
    ).get(sinceDate, ...tfOrders.params)?.c || 0;
    const pending = db.prepare(
        `SELECT COUNT(DISTINCT user_id) AS c FROM orders
         WHERE date(created_at) >= ? AND status = 'WAITING_PAYMENT'${tfOrders.sql}`
    ).get(sinceDate, ...tfOrders.params)?.c || 0;
    const pix = db.prepare(
        `SELECT COUNT(DISTINCT user_id) AS c FROM orders
         WHERE date(created_at) >= ? AND payment_method = 'pix'${tfOrders.sql}`
    ).get(sinceDate, ...tfOrders.params)?.c || 0;
    const paid = db.prepare(
        `SELECT COUNT(DISTINCT user_id) AS c FROM orders
         WHERE status IN ('PAID','DELIVERED') AND date(created_at) >= ?${tfOrders.sql}`
    ).get(sinceDate, ...tfOrders.params)?.c || 0;

    const menuOpened = auditDistinctUsers(db, sinceIso);
    const catalogAudit = auditDistinctUsers(
        db,
        sinceIso,
        ` AND (route LIKE '%catalog%' OR route LIKE '%/cat%' OR route LIKE '%cat:%' OR callback_data LIKE 'cat%')`
    );

    return {
        users,
        menuOpened,
        catalog: Math.max(catalog, catalogAudit),
        checkout,
        pending: Math.max(pending, pix),
        pix,
        paid,
    };
}

function pickStageCount(eventCountVal, legacyVal) {
    return eventCountVal > 0 ? eventCountVal : legacyVal;
}

class ConversionAnalyticsService {
    constructor(dbFactory = connect) {
        this.dbRaw = dbFactory;
    }

    getSummary(scope = null, days = 30) {
        const s = scope || getScopeFromContext();
        const key = cacheKey('summary', s.tenantId, days);
        const cached = getCached(key);
        if (cached) return cached;

        const db = this.dbRaw();
        const tfU = tenantFilter(s);
        const tfO = tenantFilter(s);
        const since30 = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
        const sinceIso = `${since30}T00:00:00.000Z`;

        const totalUsers = db.prepare(`SELECT COUNT(*) AS c FROM users WHERE 1=1${tfU.sql}`).get(...tfU.params)?.c || 0;

        let activeUsers = db.prepare(
            `SELECT COUNT(DISTINCT user_id) AS c FROM conversion_events
             WHERE datetime(created_at) >= datetime(?)${tfU.sql.replace(/tenant_id/g, 'conversion_events.tenant_id')}`
        ).get(sinceIso, ...tfU.params)?.c || 0;
        if (!activeUsers) {
            activeUsers = auditDistinctUsers(db, sinceIso);
        }

        const payers = db.prepare(
            `SELECT COUNT(DISTINCT user_id) AS c FROM orders
             WHERE status IN ('PAID','DELIVERED')${tfO.sql}`
        ).get(...tfO.params)?.c || 0;

        const revenueRow = db.prepare(
            `SELECT COALESCE(SUM(total),0) AS total FROM orders
             WHERE status IN ('PAID','DELIVERED')${tfO.sql}`
        ).get(...tfO.params);
        const revenue30Row = db.prepare(
            `SELECT COALESCE(SUM(total),0) AS total FROM orders
             WHERE status IN ('PAID','DELIVERED') AND date(created_at) >= ?${tfO.sql}`
        ).get(since30, ...tfO.params);

        const conversionPct = totalUsers > 0 ? ((payers / totalUsers) * 100) : 0;

        const topProducts = db.prepare(
            `SELECT p.name, SUM(oi.quantity) AS qty, COALESCE(SUM(oi.price * oi.quantity),0) AS revenue
             FROM order_items oi
             JOIN orders o ON o.id = oi.order_id
             LEFT JOIN products p ON p.id = oi.product_id
             WHERE o.status IN ('PAID','DELIVERED')${tfO.sql.replace(/tenant_id/g, 'o.tenant_id')}
             GROUP BY oi.product_id
             ORDER BY qty DESC
             LIMIT 5`
        ).all(...tfO.params);

        const bottomProducts = db.prepare(
            `SELECT p.name, SUM(oi.quantity) AS qty, COALESCE(SUM(oi.price * oi.quantity),0) AS revenue
             FROM order_items oi
             JOIN orders o ON o.id = oi.order_id
             LEFT JOIN products p ON p.id = oi.product_id
             WHERE o.status IN ('PAID','DELIVERED')${tfO.sql.replace(/tenant_id/g, 'o.tenant_id')}
             GROUP BY oi.product_id
             HAVING qty > 0
             ORDER BY qty ASC
             LIMIT 5`
        ).all(...tfO.params);

        let topCommands = [];
        try {
            topCommands = db.prepare(
                `SELECT cmd, SUM(c) AS uses FROM (
                    SELECT route AS cmd, COUNT(*) AS c FROM telegram_event_audit
                    WHERE datetime(created_at) >= datetime(?)
                      AND route LIKE '/%'
                    GROUP BY route
                    UNION ALL
                    SELECT TRIM(SUBSTR(message_text, 1, INSTR(message_text || ' ', ' ') - 1)) AS cmd, COUNT(*) AS c
                    FROM telegram_event_audit
                    WHERE datetime(created_at) >= datetime(?)
                      AND message_text LIKE '/%'
                    GROUP BY cmd
                 )
                 GROUP BY cmd
                 HAVING cmd LIKE '/%'
                 ORDER BY uses DESC
                 LIMIT 8`
            ).all(sinceIso, sinceIso);
        } catch (_) { /* tabela opcional */ }

        const data = {
            totalUsers,
            activeUsers,
            payers,
            conversionPct: Math.round(conversionPct * 100) / 100,
            revenueTotal: Number(revenueRow?.total) || 0,
            revenue30d: Number(revenue30Row?.total) || 0,
            topProducts,
            bottomProducts,
            topCommands,
            days,
        };
        setCache(key, data);
        return data;
    }

    getFunnel(scope = null, days = 30) {
        const s = scope || getScopeFromContext();
        const key = cacheKey('funnel', s.tenantId, days);
        const cached = getCached(key);
        if (cached) return cached;

        const db = this.dbRaw();
        const sinceDate = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
        const sinceIso = `${sinceDate}T00:00:00.000Z`;
        const tf = tenantFilter(s);
        const tfU = tenantFilter(s);
        const tfO = tenantFilter(s);
        const tfC = tenantFilter(s);

        const leg = legacyFunnel(db, sinceDate, sinceIso, tfU, tfO, tfC);
        const hasEvents =
            (db.prepare(
                `SELECT COUNT(*) AS c FROM conversion_events WHERE datetime(created_at) >= datetime(?)`
            ).get(sinceIso)?.c || 0) > 0;

        let stages;
        if (hasEvents) {
            stages = [
                { stage: 'Entraram (/start)', event: 'user_started', count: pickStageCount(eventCount(db, 'user_started', sinceIso, tf), leg.users) },
                { stage: 'Abriram menu', event: 'menu_opened', count: pickStageCount(eventCount(db, 'menu_opened', sinceIso, tf), leg.menuOpened) },
                { stage: 'Viram catálogo', event: 'catalog_opened', count: pickStageCount(eventCount(db, 'catalog_opened', sinceIso, tf), leg.catalog) },
                { stage: 'Viram produto', event: 'product_viewed', count: pickStageCount(eventCount(db, 'product_viewed', sinceIso, tf), leg.catalog) },
                { stage: 'Criaram carrinho', event: 'cart_created', count: pickStageCount(eventCount(db, 'cart_created', sinceIso, tf), leg.catalog) },
                { stage: 'Iniciaram checkout', event: 'checkout_started', count: pickStageCount(eventCount(db, 'checkout_started', sinceIso, tf), leg.checkout) },
                { stage: 'Pagamento pendente', event: 'payment_pending', count: pickStageCount(eventCount(db, 'payment_pending', sinceIso, tf), leg.pending) },
                { stage: 'Pagaram', event: 'payment_approved', count: pickStageCount(eventCount(db, 'payment_approved', sinceIso, tf), leg.paid) },
                { stage: 'Receberam entrega', event: 'delivery_completed', count: pickStageCount(eventCount(db, 'delivery_completed', sinceIso, tf), leg.paid) },
            ];
        } else {
            stages = [
                { stage: 'Usuários novos', count: leg.users },
                { stage: 'Interagiram (audit)', count: leg.menuOpened },
                { stage: 'Viram catálogo', count: leg.catalog },
                { stage: 'Iniciaram checkout', count: leg.checkout },
                { stage: 'Pagamento pendente', count: leg.pending },
                { stage: 'Pagaram', count: leg.paid },
            ];
        }

        const base = stages[0]?.count || 0;
        const withPct = stages.map((st, i) => ({
            ...st,
            pctOfTotal: base > 0 ? Math.round((st.count / base) * 1000) / 10 : 0,
            dropFromPrev: i > 0 && stages[i - 1].count > 0
                ? Math.round(((stages[i - 1].count - st.count) / stages[i - 1].count) * 1000) / 10
                : 0,
        }));

        const paidStage = withPct.find((st) => st.stage.includes('Pagaram')) || withPct[withPct.length - 1];
        const data = {
            days,
            stages: withPct,
            conversionFinalPct: base > 0 ? Math.round((paidStage.count / base) * 1000) / 10 : 0,
            source: hasEvents ? 'events+legacy' : 'legacy',
        };
        setCache(key, data);
        return data;
    }

    getLostUserCounts(scope = null) {
        const s = scope || getScopeFromContext();
        const db = this.dbRaw();
        const tfU = tenantFilter(s);
        const tfO = tenantFilter(s);
        const tfC = tenantFilter(s);

        const noPurchase = db.prepare(
            `SELECT COUNT(*) AS c FROM users u
             WHERE NOT EXISTS (
               SELECT 1 FROM orders o WHERE o.user_id = u.id AND o.status IN ('PAID','DELIVERED')
             )${tfU.sql.replace(/tenant_id/g, 'u.tenant_id')}`
        ).get(...tfU.params)?.c || 0;

        const abandonedCart = db.prepare(
            `SELECT COUNT(DISTINCT ac.user_id) AS c FROM active_carts ac
             WHERE NOT EXISTS (
               SELECT 1 FROM orders o WHERE o.user_id = ac.user_id
                 AND o.status IN ('PAID','DELIVERED','WAITING_PAYMENT')
             )${tfC.sql.replace(/tenant_id/g, 'ac.tenant_id')}`
        ).get(...tfC.params)?.c || 0;

        const pixUnpaid = db.prepare(
            `SELECT COUNT(DISTINCT o.user_id) AS c FROM orders o
             WHERE o.status = 'WAITING_PAYMENT'
               AND (o.payment_method = 'pix' OR o.payment_id IS NOT NULL)${tfO.sql.replace(/tenant_id/g, 'o.tenant_id')}`
        ).get(...tfO.params)?.c || 0;

        const inactive30 = db.prepare(
            `SELECT COUNT(*) AS c FROM users u
             WHERE datetime(u.created_at) < datetime('now', '-30 days')
             AND NOT EXISTS (
               SELECT 1 FROM conversion_events ce
               WHERE ce.user_id = u.id AND datetime(ce.created_at) >= datetime('now', '-30 days')
             )
             AND NOT EXISTS (
               SELECT 1 FROM telegram_event_audit te
               WHERE te.user_id = CAST(u.telegram_id AS TEXT)
                 AND datetime(te.created_at) >= datetime('now', '-30 days')
             )${tfU.sql.replace(/tenant_id/g, 'u.tenant_id')}`
        ).get(...tfU.params)?.c || 0;

        return { noPurchase, abandonedCart, pixUnpaid, inactive30 };
    }

    getLostUsers(scope = null, limit = 50) {
        const s = scope || getScopeFromContext();
        const db = this.dbRaw();
        const tfU = tenantFilter(s);
        const tfO = tenantFilter(s);
        const tfC = tenantFilter(s);
        const cap = Math.min(Math.max(limit, 1), 100);
        const counts = this.getLostUserCounts(s);

        const noPurchase = db.prepare(
            `SELECT u.id, u.telegram_id, u.first_name, u.username, u.created_at
             FROM users u
             WHERE NOT EXISTS (
               SELECT 1 FROM orders o WHERE o.user_id = u.id AND o.status IN ('PAID','DELIVERED')
             )${tfU.sql.replace(/tenant_id/g, 'u.tenant_id')}
             ORDER BY u.created_at DESC
             LIMIT ?`
        ).all(...tfU.params, cap);

        const abandonedCart = db.prepare(
            `SELECT DISTINCT u.id, u.telegram_id, u.first_name, u.username, MAX(ac.updated_at) AS last_cart
             FROM active_carts ac
             JOIN users u ON u.id = ac.user_id
             WHERE NOT EXISTS (
               SELECT 1 FROM orders o WHERE o.user_id = u.id AND o.status IN ('PAID','DELIVERED','WAITING_PAYMENT')
             )${tfC.sql.replace(/tenant_id/g, 'ac.tenant_id')}
             GROUP BY u.id
             ORDER BY last_cart DESC
             LIMIT ?`
        ).all(...tfC.params, cap);

        const pixUnpaid = db.prepare(
            `SELECT DISTINCT u.id, u.telegram_id, u.first_name, u.username, o.id AS order_id, o.created_at
             FROM orders o
             JOIN users u ON u.id = o.user_id
             WHERE o.status = 'WAITING_PAYMENT'
               AND (o.payment_method = 'pix' OR o.payment_id IS NOT NULL)${tfO.sql.replace(/tenant_id/g, 'o.tenant_id')}
             ORDER BY o.created_at DESC
             LIMIT ?`
        ).all(...tfO.params, cap);

        const inactive30 = db.prepare(
            `SELECT u.id, u.telegram_id, u.first_name, u.username, u.created_at
             FROM users u
             WHERE datetime(u.created_at) < datetime('now', '-30 days')
             AND NOT EXISTS (
               SELECT 1 FROM conversion_events ce
               WHERE ce.user_id = u.id AND datetime(ce.created_at) >= datetime('now', '-30 days')
             )
             AND NOT EXISTS (
               SELECT 1 FROM telegram_event_audit te
               WHERE te.user_id = CAST(u.telegram_id AS TEXT)
                 AND datetime(te.created_at) >= datetime('now', '-30 days')
             )${tfU.sql.replace(/tenant_id/g, 'u.tenant_id')}
             ORDER BY u.created_at ASC
             LIMIT ?`
        ).all(...tfU.params, cap);

        return {
            counts: {
                noPurchase,
                abandonedCart,
                pixUnpaid,
                inactive30,
            },
            noPurchase,
            abandonedCart,
            pixUnpaid,
            inactive30,
            limit: cap,
        };
    }
}

module.exports = { ConversionAnalyticsService, conversionAnalytics: new ConversionAnalyticsService() };
