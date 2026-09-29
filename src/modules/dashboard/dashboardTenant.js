'use strict';

/**
 * Escopo de tenant para o painel web (/admin).
 * - legacy: loja principal (tenant_id IS NULL)
 * - tenant: loja SaaS específica
 * - all: todas as lojas (visão plataforma)
 */

const { checkIdorOnMiss } = require('./dashboardTenantAudit');

function parseDashboardTenant(req) {
    const raw =
        req.headers['x-tenant-id'] ??
        req.query?.tenant_id ??
        req.cookies?.dashboard_tenant ??
        'legacy';

    if (raw === 'all' || raw === '*') {
        return { mode: 'all', tenantId: null, label: 'Todas as lojas' };
    }
    if (raw === 'legacy' || raw === 'main' || raw === 'null' || raw === '') {
        return { mode: 'legacy', tenantId: null, label: 'Loja principal' };
    }
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) {
        return { mode: 'tenant', tenantId: n, label: `Loja #${n}` };
    }
    return { mode: 'legacy', tenantId: null, label: 'Loja principal' };
}

function clause(column, scope, alias = '') {
    const col = alias ? `${alias}.${column}` : column;
    if (scope.mode === 'tenant' && scope.tenantId != null) {
        return { sql: ` AND ${col} = ?`, params: [scope.tenantId] };
    }
    if (scope.mode === 'legacy') {
        return { sql: ` AND ${col} IS NULL`, params: [] };
    }
    return { sql: '', params: [] };
}

function cacheKey(prefix, scope) {
    const id = scope.mode === 'tenant' ? scope.tenantId : scope.mode;
    return `${prefix}:${id}`;
}

function clauseInline(column, scope, alias = '') {
    const c = clause(column, scope, alias);
    if (!c.sql) return '';
    if (!c.params.length) return c.sql;
    const n = Number(c.params[0]);
    if (!Number.isFinite(n)) return c.sql;
    return c.sql.replace('?', String(n));
}

const SCOPED_TABLES = new Set(['products', 'coupons', 'orders']);

/**
 * Busca registro por id respeitando escopo tenant (SEC-C1).
 * @param {object} [req] — request Express para auditoria IDOR
 * @returns {object|null}
 */
function findByIdInScope(db, table, id, scope, req = null) {
    if (!SCOPED_TABLES.has(table)) {
        throw new Error(`Tabela não permitida para escopo: ${table}`);
    }
    const t = clause('tenant_id', scope);
    const row =
        db.prepare(`SELECT * FROM ${table} WHERE id = ?${t.sql} LIMIT 1`).get(Number(id), ...t.params) ||
        null;
    if (!row && req) checkIdorOnMiss(db, table, id, scope, req);
    return row;
}

function validateDashboardTenantSwitch(raw) {
    const val = String(raw ?? 'legacy').trim();
    if (val === 'all' || val === '*') {
        return { ok: true, value: 'all' };
    }
    if (val === 'legacy' || val === 'main' || val === 'null' || val === '') {
        return { ok: true, value: 'legacy' };
    }
    const n = Number(val);
    if (!Number.isFinite(n) || n <= 0) {
        return { ok: false, error: 'tenant_id inválido' };
    }
    try {
        const TenantService = require('../tenant/TenantService');
        const t = TenantService.getById(n);
        if (!t) return { ok: false, error: 'Loja não encontrada' };
        return { ok: true, value: String(n) };
    } catch {
        return { ok: false, error: 'Não foi possível validar loja' };
    }
}

/**
 * Mutations (POST/PUT/DELETE) exigem escopo legacy ou tenant — não "all" (SEC-C1).
 * @returns {{ ok: true } | { ok: false, status: number, error: string }}
 */
function requireMutationScope(scope) {
    if (scope?.mode === 'all') {
        return {
            ok: false,
            status: 403,
            error: 'Selecione uma loja específica (Loja principal ou tenant) para alterar dados',
        };
    }
    return { ok: true };
}

module.exports = {
    parseDashboardTenant,
    clause,
    clauseInline,
    cacheKey,
    findByIdInScope,
    validateDashboardTenantSwitch,
    requireMutationScope,
};
