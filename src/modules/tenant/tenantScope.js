'use strict';

/**
 * Escopo SQL por tenant — legacy (tenant_id NULL) vs loja SaaS (tenant_id = N).
 */

function getTenantContext() {
    return require('../../infrastructure/TenantContext');
}

/** @returns {{ mode: 'legacy'|'tenant'|'platform', tenantId: number|null, tenant: object|null }} */
function getScopeFromContext() {
    const tenant = getTenantContext().getCurrent();
    if (!tenant) return { mode: 'legacy', tenantId: null, tenant: null };
    if (tenant.mode === 'platform') return { mode: 'platform', tenantId: null, tenant: null };
    if (tenant.mode === 'tenant' && tenant.id != null) {
        return { mode: 'tenant', tenantId: Number(tenant.id), tenant };
    }
    return { mode: 'legacy', tenantId: null, tenant: null };
}

function isPlatformAdmin(telegramId) {
    const ids = (process.env.ID_DONO || '')
        .split(',')
        .map((s) => parseInt(s.trim(), 10))
        .filter(Boolean);
    return ids.includes(Number(telegramId));
}

/** Clausula AND para filtrar tenant em queries */
function tenantSql(column = 'tenant_id', scope = null) {
    const s = scope || getScopeFromContext();
    if (s.mode === 'tenant' && s.tenantId != null) {
        return { clause: `${column} = ?`, params: [s.tenantId] };
    }
    if (s.mode === 'legacy') {
        return { clause: `${column} IS NULL`, params: [] };
    }
    return { clause: '1=1', params: [] };
}

function appendTenantWhere(baseSql, baseParams, column = 'tenant_id', scope = null) {
    const t = tenantSql(column, scope);
    const connector = baseSql.includes('WHERE') ? ` AND ${t.clause}` : ` WHERE ${t.clause}`;

    const upper = baseSql.toUpperCase();
    const tailMatch = upper.match(/\s+(ORDER\s+BY|GROUP\s+BY|HAVING|LIMIT|OFFSET)\b/);
    let head = baseSql;
    let tail = '';
    if (tailMatch && tailMatch.index != null) {
        head = baseSql.slice(0, tailMatch.index);
        tail = baseSql.slice(tailMatch.index);
    }

    return { sql: `${head}${connector}${tail}`, params: [...baseParams, ...t.params] };
}

function resolveMpPayerEmail(tenant) {
    if (tenant?.mp_payer_email) return tenant.mp_payer_email;
    return process.env.MP_PAYER_EMAIL || null;
}

/** Tabelas com coluna tenant_id no schema SaaS */
const TABLES_WITH_TENANT = new Set([
    'users', 'products', 'orders', 'order_items', 'coupons', 'reviews', 'affiliates', 'referrals',
    'favorites', 'support_tickets', 'ticket_messages', 'abandoned_carts', 'loyalty_points',
    'points_history', 'notifications_sent', 'cash_flow', 'sales_goals', 'subscriptions', 'cashback',
    'giveaways', 'giveaway_participants', 'flash_sales', 'restock_notify', 'active_carts',
    'pending_purchases', 'applied_coupons', 'user_sessions', 'checkout_cooldowns', 'last_menu_messages',
    'user_notifications', 'telegram_groups', 'group_members', 'audit_logs', 'spam_bans',
    'processed_webhooks', 'affiliate_commissions', 'conversion_events',
]);

/** Lookup por chave globalmente única — webhooks/recovery sem TenantContext */
const GLOBAL_LOOKUP_KEYS = {
    orders: new Set(['id', 'external_reference', 'payment_id']),
    users: new Set(['id', 'telegram_id']),
    products: new Set(['id']),
    coupons: new Set(['code']),
    affiliates: new Set(['code', 'user_id']),
    pending_purchases: new Set(['order_id']),
    order_items: new Set(['order_id']),
    processed_webhooks: new Set(['payment_id', 'webhook_id']),
};

function rowInScope(row, column = 'tenant_id') {
    if (!row) return null;
    const scope = getScopeFromContext();
    const tid = row[column];
    if (scope.mode === 'platform') return row;
    if (scope.mode === 'tenant') {
        return tid != null && Number(tid) === scope.tenantId ? row : null;
    }
    return tid == null ? row : null;
}

function filterRowsInScope(rows, column = 'tenant_id') {
    if (!Array.isArray(rows)) return rows;
    const scope = getScopeFromContext();
    if (scope.mode === 'platform') return rows;
    if (scope.mode === 'tenant') {
        return rows.filter((r) => r[column] != null && Number(r[column]) === scope.tenantId);
    }
    return rows.filter((r) => r[column] == null);
}

function tenantIdForInsert(explicit) {
    if (explicit !== undefined) return explicit;
    const scope = getScopeFromContext();
    return scope.mode === 'tenant' && scope.tenantId != null ? scope.tenantId : null;
}

function _whereKeys(where) {
    if (!where || typeof where !== 'object') return [];
    return Object.keys(where).filter((k) => k !== 'skipTenantScope' && where[k] !== undefined);
}

function shouldBypassTenantFilter(table, where, opts = {}) {
    if (opts.skipTenantScope || where?.skipTenantScope) return true;
    if (!TABLES_WITH_TENANT.has(table)) return true;
    const scope = getScopeFromContext();
    if (scope.mode === 'platform') return true;

    const keys = _whereKeys(where);
    const global = GLOBAL_LOOKUP_KEYS[table];
    if (global && keys.length > 0 && keys.every((k) => global.has(k))) return true;

    // Jobs de sistema (startupRecovery, SafeWebhookHandler) — status-only em orders
    if (table === 'orders' && keys.length === 1 && keys[0] === 'status') return true;
    if (table === 'orders' && keys.length === 2 && keys.includes('id') && keys.includes('status')) return true;

    return false;
}

function scopePrismaSql(baseSql, baseParams, table, opts = {}) {
    if (!TABLES_WITH_TENANT.has(table)) return { sql: baseSql, params: baseParams };
    if (shouldBypassTenantFilter(table, opts.where, opts)) return { sql: baseSql, params: baseParams };
    return appendTenantWhere(baseSql, baseParams, opts.column || 'tenant_id', opts.scope);
}

/** UPDATE/DELETE — bypass em chaves globais (id, order_id, telegram_id, code) */
function scopePrismaMutation(baseSql, baseParams, table, opts = {}) {
    if (opts.skipTenantScope) return { sql: baseSql, params: baseParams };
    if (!TABLES_WITH_TENANT.has(table)) return { sql: baseSql, params: baseParams };
    const scope = getScopeFromContext();
    if (scope.mode === 'platform') return { sql: baseSql, params: baseParams };

    const sql = baseSql.toUpperCase();
    if (/\bWHERE\s+ID\s*=\s*\?/.test(sql)) return { sql: baseSql, params: baseParams };
    if (table === 'users' && /\bWHERE\s+TELEGRAM_ID\s*=\s*\?/.test(sql)) return { sql: baseSql, params: baseParams };
    if (/\bWHERE\s+ORDER_ID\s*=\s*\?/.test(sql)) return { sql: baseSql, params: baseParams };
    if (table === 'coupons' && /\bWHERE\s+CODE\s*=\s*\?/.test(sql)) return { sql: baseSql, params: baseParams };
    if (table === 'orders' && /\bWHERE\s+EXTERNAL_REFERENCE\s*=\s*\?/.test(sql)) return { sql: baseSql, params: baseParams };
    if (table === 'orders' && /\bWHERE\s+PAYMENT_ID\s*=\s*\?/.test(sql)) return { sql: baseSql, params: baseParams };

    return appendTenantWhere(baseSql, baseParams, opts.column || 'tenant_id', opts.scope);
}

module.exports = {
    getScopeFromContext,
    isPlatformAdmin,
    tenantSql,
    appendTenantWhere,
    resolveMpPayerEmail,
    TABLES_WITH_TENANT,
    rowInScope,
    filterRowsInScope,
    tenantIdForInsert,
    shouldBypassTenantFilter,
    scopePrismaSql,
    scopePrismaMutation,
};
