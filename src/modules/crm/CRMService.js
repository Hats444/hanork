/**
 * CRMService — segmentação e tags de clientes
 * Tags automáticas baseadas em comportamento + tags manuais
 * Segmentos usados para broadcasts direcionados
 * SEC-C2: queries respeitam tenantScope do dashboard
 */
'use strict';

const logger = require('../../config/logger');
const { clause } = require('../dashboard/dashboardTenant');

const DEFAULT_SCOPE = { mode: 'legacy', tenantId: null, label: 'Loja principal' };

function db() {
    return require('../../config/database-sqlite').connect();
}

function normalizeScope(scope) {
    return scope || DEFAULT_SCOPE;
}

function userClause(scope, alias = 'u') {
    return clause('tenant_id', normalizeScope(scope), alias);
}

function orderClause(scope, alias = 'o') {
    return clause('tenant_id', normalizeScope(scope), alias);
}

/** SQL inline para subqueries com múltiplas referências (tenantId validado internamente). */
function orderTenantSql(scope, alias = 'o') {
    const s = normalizeScope(scope);
    const col = `${alias}.tenant_id`;
    if (s.mode === 'tenant' && s.tenantId != null) {
        return ` AND ${col} = ${Number(s.tenantId)}`;
    }
    if (s.mode === 'legacy') {
        return ` AND ${col} IS NULL`;
    }
    return '';
}

function userTenantSql(scope, alias = 'u') {
    const s = normalizeScope(scope);
    const col = `${alias}.tenant_id`;
    if (s.mode === 'tenant' && s.tenantId != null) {
        return ` AND ${col} = ${Number(s.tenantId)}`;
    }
    if (s.mode === 'legacy') {
        return ` AND ${col} IS NULL`;
    }
    return '';
}

function findUserInScope(telegramId, scope = DEFAULT_SCOPE) {
    const ut = userClause(scope);
    return (
        db()
            .prepare(`SELECT * FROM users u WHERE u.telegram_id = ?${ut.sql} LIMIT 1`)
            .get(String(telegramId), ...ut.params) || null
    );
}

// Tags automáticas calculadas on-demand (enrichUser row)
const AUTO_TAGS = {
    comprador: (u) => u.orders_count > 0,
    comprou_2x: (u) => u.orders_count >= 2,
    comprou_5x: (u) => u.orders_count >= 5,
    vip: (u) => u.total_spent >= 200,
    premium: (u) => !!u.is_premium,
    carrinho_abando: (u) => u.abandoned_count > 0,
    inativo_30d: (u) => u.days_since_last_order > 30,
    inativo_60d: (u) => u.days_since_last_order > 60,
    novo: (u) => u.days_since_join <= 7,
    afiliado: (u) => !!u.is_affiliate,
};

function buildAutoTagDefs(scope) {
    const os = orderTenantSql(scope);
    const orderCount = (min) =>
        `(SELECT COUNT(*) FROM orders o WHERE o.user_id=u.id AND o.status IN ('PAID','DELIVERED')${os}) >= ${min}`;
    const orderSum = `(SELECT COALESCE(SUM(o.total),0) FROM orders o WHERE o.user_id=u.id AND o.status IN ('PAID','DELIVERED')${os})`;
    const lastOrderDays = `(julianday('now') - julianday((SELECT MAX(o.created_at) FROM orders o WHERE o.user_id=u.id${os})))`;

    return {
        comprador: orderCount(1),
        comprou_2x: orderCount(2),
        comprou_5x: orderCount(5),
        vip: `${orderSum} >= 200`,
        premium: `EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id=u.id AND s.status IN ('active','cancelled') AND datetime(replace(substr(s.next_payment_date, 1, 19), 'T', ' ')) > datetime('now'))`,
        carrinho_abando: `(SELECT COUNT(*) FROM abandoned_carts ac WHERE ac.telegram_id=u.telegram_id) > 0`,
        inativo_30d: `${lastOrderDays} > 30`,
        inativo_60d: `${lastOrderDays} > 60`,
        novo: `(julianday('now') - julianday(u.created_at)) <= 7`,
        afiliado: `EXISTS (SELECT 1 FROM affiliates a WHERE a.user_id=u.id)`,
    };
}

class CRMService {

    getAutoTags(userRow) {
        return Object.entries(AUTO_TAGS)
            .filter(([, fn]) => {
                try {
                    return fn(userRow);
                } catch {
                    return false;
                }
            })
            .map(([tag]) => tag);
    }

    enrichUser(telegramId, scope = DEFAULT_SCOPE) {
        const u = findUserInScope(telegramId, scope);
        if (!u) return null;

        const d = db();
        const ot = orderClause(scope);
        const orders = d
            .prepare(
                `SELECT COUNT(*) as c, COALESCE(SUM(o.total),0) as s, MAX(o.created_at) as last
                 FROM orders o WHERE o.user_id=? AND o.status IN ('PAID','DELIVERED')${ot.sql}`
            )
            .get(u.id, ...ot.params);
        const abandoned = d.prepare(`SELECT COUNT(*) as c FROM abandoned_carts WHERE telegram_id=?`).get(String(telegramId))?.c || 0;
        const affiliate = d.prepare(`SELECT id FROM affiliates WHERE user_id=?`).get(u.id);
        const premium = d.prepare(`
            SELECT 1 FROM subscriptions
            WHERE user_id = ? AND status IN ('active', 'cancelled')
            AND datetime(replace(substr(next_payment_date, 1, 19), 'T', ' ')) > datetime('now')
            LIMIT 1
        `).get(u.id);
        const daysJoin = Math.floor((Date.now() - new Date(u.created_at).getTime()) / 86400000);
        const daysLast = orders.last ? Math.floor((Date.now() - new Date(orders.last).getTime()) / 86400000) : 999;

        const enriched = {
            ...u,
            orders_count: orders.c || 0,
            total_spent: orders.s || 0,
            last_order_at: orders.last || null,
            abandoned_count: abandoned,
            is_affiliate: !!affiliate,
            is_premium: !!premium,
            days_since_join: daysJoin,
            days_since_last_order: daysLast,
        };

        enriched.auto_tags = this.getAutoTags(enriched);
        return enriched;
    }

    _tagKey(telegramId) {
        return `crm_tags_${telegramId}`;
    }

    getManualTags(telegramId) {
        try {
            const row = db().prepare('SELECT value FROM kv_store WHERE key=?').get(this._tagKey(telegramId));
            return row ? JSON.parse(row.value) : [];
        } catch {
            return [];
        }
    }

    addTag(telegramId, tag, scope = DEFAULT_SCOPE) {
        if (!findUserInScope(telegramId, scope)) {
            throw new Error('Usuário não encontrado neste escopo');
        }
        const tags = this.getManualTags(telegramId);
        if (!tags.includes(tag)) {
            tags.push(tag);
            db()
                .prepare(`INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?,?,datetime('now'))`)
                .run(this._tagKey(telegramId), JSON.stringify(tags));
            logger.info(`[CRM] Tag adicionada: ${telegramId} → ${tag}`);
        }
    }

    removeTag(telegramId, tag, scope = DEFAULT_SCOPE) {
        if (!findUserInScope(telegramId, scope)) {
            throw new Error('Usuário não encontrado neste escopo');
        }
        const tags = this.getManualTags(telegramId).filter((t) => t !== tag);
        db()
            .prepare(`INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?,?,datetime('now'))`)
            .run(this._tagKey(telegramId), JSON.stringify(tags));
    }

    getAllTags(telegramId, scope = DEFAULT_SCOPE) {
        const enriched = this.enrichUser(telegramId, scope);
        const auto = enriched?.auto_tags || [];
        const manual = this.getManualTags(telegramId);
        return [...new Set([...auto, ...manual])];
    }

    getUsersBySegment(tags = [], logic = 'OR', limit = 500, scope = DEFAULT_SCOPE) {
        if (!tags.length) return [];
        const d = db();
        const us = userTenantSql(scope);
        const autoTagDefs = buildAutoTagDefs(scope);

        const conditions = tags.filter((t) => autoTagDefs[t]).map((t) => `(${autoTagDefs[t]})`);

        const manualTags = tags.filter((t) => !autoTagDefs[t]);
        const manualConditions = manualTags.map(
            (t) =>
                `EXISTS (SELECT 1 FROM kv_store WHERE key='crm_tags_'||u.telegram_id AND value LIKE '%"${t.replace(/"/g, '')}"% ')`
        );

        const all = [...conditions, ...manualConditions];
        if (!all.length) return [];

        const where = logic === 'AND' ? all.join(' AND ') : all.join(' OR ');

        try {
            return d
                .prepare(
                    `SELECT u.telegram_id, u.first_name, u.username FROM users u WHERE (${where})${us} LIMIT ?`
                )
                .all(limit);
        } catch (e) {
            logger.error(`[CRM] Segmentação erro: ${e.message}`);
            return [];
        }
    }

    getSegmentStats(scope = DEFAULT_SCOPE) {
        const d = db();
        const ut = userClause(scope);
        const ot = orderClause(scope);

        return {
            scope: normalizeScope(scope),
            total_users: d.prepare(`SELECT COUNT(*) as c FROM users u WHERE 1=1${ut.sql}`).get(...ut.params)?.c || 0,
            compradores:
                d.prepare(
                    `SELECT COUNT(DISTINCT o.user_id) as c FROM orders o WHERE o.status IN ('PAID','DELIVERED')${ot.sql}`
                ).get(...ot.params)?.c || 0,
            recorrentes:
                d.prepare(
                    `SELECT COUNT(*) as c FROM (
                        SELECT o.user_id, COUNT(*) as cnt FROM orders o
                        WHERE o.status IN ('PAID','DELIVERED')${ot.sql}
                        GROUP BY o.user_id HAVING cnt >= 2
                    )`
                ).get(...ot.params)?.c || 0,
            vips:
                d.prepare(
                    `SELECT COUNT(*) as c FROM (
                        SELECT o.user_id, SUM(o.total) as s FROM orders o
                        WHERE o.status IN ('PAID','DELIVERED')${ot.sql}
                        GROUP BY o.user_id HAVING s >= 200
                    )`
                ).get(...ot.params)?.c || 0,
            inativos_30d:
                d.prepare(
                    `SELECT COUNT(*) as c FROM users u WHERE 1=1${userTenantSql(scope)}
                     AND NOT EXISTS (
                        SELECT 1 FROM orders o WHERE o.user_id=u.id AND o.created_at >= datetime('now','-30 days')${orderTenantSql(scope)}
                     )`
                ).get()?.c || 0,
            premium:
                d.prepare(
                    `SELECT COUNT(*) as c FROM subscriptions s
                     INNER JOIN users u ON u.id = s.user_id
                     WHERE s.status IN ('active','cancelled')
                     AND datetime(replace(substr(s.next_payment_date, 1, 19), 'T', ' ')) > datetime('now')${userTenantSql(scope)}`
                ).get()?.c || 0,
        };
    }

    getCustomerHistory(telegramId, scope = DEFAULT_SCOPE) {
        const u = findUserInScope(telegramId, scope);
        if (!u) return null;

        const d = db();
        const ot = orderClause(scope);
        const orders = d
            .prepare(
                `SELECT o.*, GROUP_CONCAT(oi.name, ', ') as items FROM orders o
                 LEFT JOIN order_items oi ON oi.order_id=o.id
                 WHERE o.user_id=?${ot.sql}
                 GROUP BY o.id ORDER BY o.created_at DESC LIMIT 50`
            )
            .all(u.id, ...ot.params);
        const reviews = d.prepare('SELECT * FROM reviews WHERE user_id=? ORDER BY created_at DESC').all(u.id);
        const tickets = d.prepare('SELECT * FROM support_tickets WHERE user_id=? ORDER BY created_at DESC LIMIT 10').all(u.id);
        const tags = this.getAllTags(telegramId, scope);

        return {
            user: this.enrichUser(telegramId, scope),
            orders,
            reviews,
            tickets,
            tags,
        };
    }
}

module.exports = new CRMService();
module.exports._test = {
    findUserInScope,
    userClause,
    orderClause,
    userTenantSql,
    orderTenantSql,
    buildAutoTagDefs,
    DEFAULT_SCOPE,
};
