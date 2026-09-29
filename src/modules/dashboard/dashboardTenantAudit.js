'use strict';

/**
 * Modo auditoria IDOR do dashboard (SEC-C1 / evolução 4.1).
 * - DASHBOARD_TENANT_AUDIT=1 → loga tentativas cross-tenant / endpoints sem escopo
 * - DASHBOARD_TENANT_ENFORCE=1 → bloqueia além de logar (opt-in; padrão desligado)
 */

const logger = require('../../config/logger');

const DEDUP_MS = Math.max(5000, Number(process.env.DASHBOARD_IDOR_DEDUP_MS) || 60000);
const _recent = new Map();

function flag(v, defaultOn = false) {
    if (v === undefined || v === null || v === '') return defaultOn;
    const s = String(v).trim().toLowerCase();
    return s === '1' || s === 'true' || s === 'yes';
}

function isAuditEnabled() {
    return flag(process.env.DASHBOARD_TENANT_AUDIT, true);
}

function isEnforceEnabled() {
    return flag(process.env.DASHBOARD_TENANT_ENFORCE, false);
}

function rowTenantId(row) {
    if (!row || !Object.prototype.hasOwnProperty.call(row, 'tenant_id')) return undefined;
    const v = row.tenant_id;
    return v == null ? null : Number(v);
}

function rowMatchesScope(row, scope) {
    if (!scope || scope.mode === 'all') return true;
    const tid = rowTenantId(row);
    if (scope.mode === 'legacy') return tid == null;
    if (scope.mode === 'tenant') return tid === scope.tenantId;
    return true;
}

function dedupKey(parts) {
    return parts.filter((p) => p != null && p !== '').join('|');
}

function shouldLog(key) {
    const now = Date.now();
    const last = _recent.get(key) || 0;
    if (now - last < DEDUP_MS) return false;
    _recent.set(key, now);
    if (_recent.size > 500) {
        const cutoff = now - DEDUP_MS;
        for (const [k, t] of _recent) {
            if (t < cutoff) _recent.delete(k);
        }
    }
    return true;
}

function auditEvent(req, event, meta = {}) {
    if (!isAuditEnabled()) return;
    const scope = req?.tenantScope || meta.scope;
    const path = req?.method && req?.path ? `${req.method} ${req.path}` : meta.path;
    const key = dedupKey([event, meta.table, meta.resourceId, scope?.mode, scope?.tenantId, path]);
    if (!shouldLog(key)) return;
    logger.warn('[DASHBOARD:IDOR-AUDIT]', {
        event,
        path,
        scope,
        enforce: isEnforceEnabled(),
        ...meta,
    });
}

function auditIdorCrossTenant(req, { table, resourceId, scope, actualTenantId, action = 'read' }) {
    auditEvent(req, 'cross_tenant_access', {
        table,
        resourceId,
        scope,
        actualTenantId,
        action,
        expected:
            scope?.mode === 'tenant'
                ? scope.tenantId
                : scope?.mode === 'legacy'
                  ? null
                  : 'any',
    });
}

function auditUnscopedEndpoint(req, reason) {
    auditEvent(req, 'unscoped_endpoint', { reason });
}

function auditRowsLeak(req, { table, scope, leaked }) {
    if (!leaked?.length) return;
    auditEvent(req, 'response_tenant_leak', {
        table,
        scope,
        count: leaked.length,
        sampleIds: leaked.slice(0, 5).map((r) => r.id ?? r.telegram_id),
    });
}

function filterRowsToScope(rows, scope) {
    if (!Array.isArray(rows) || !scope || scope.mode === 'all') return rows;
    return rows.filter((r) => rowMatchesScope(r, scope));
}

/**
 * Verifica linhas retornadas; em enforce remove as fora do escopo.
 */
function verifyAndAuditRows(req, rows, scope, table) {
    if (!Array.isArray(rows) || !scope || scope.mode === 'all') return rows;
    const leaked = rows.filter((r) => !rowMatchesScope(r, scope));
    if (!leaked.length) return rows;
    auditRowsLeak(req, { table, scope, leaked });
    return isEnforceEnabled() ? filterRowsToScope(rows, scope) : rows;
}

/**
 * Quando findByIdInScope retorna null, detecta se o id existe em outro tenant.
 */
function checkIdorOnMiss(db, table, id, scope, req) {
    if (!isAuditEnabled() && !isEnforceEnabled()) return;
    if (!scope || scope.mode === 'all') return;
    let row;
    try {
        row = db.prepare(`SELECT id, tenant_id FROM ${table} WHERE id = ? LIMIT 1`).get(Number(id));
    } catch {
        return;
    }
    if (row && !rowMatchesScope(row, scope)) {
        auditIdorCrossTenant(req, {
            table,
            resourceId: id,
            scope,
            actualTenantId: row.tenant_id,
        });
    }
}

function auditTenantResourceAccess(req, resourceTenantId, resourceId, table = 'tenants') {
    const scope = req?.tenantScope;
    if (!scope || scope.mode === 'all') return true;
    if (scope.mode === 'legacy') return true;
    if (scope.mode === 'tenant' && Number(resourceTenantId) === scope.tenantId) return true;
    auditIdorCrossTenant(req, {
        table,
        resourceId,
        scope,
        actualTenantId: resourceTenantId,
    });
    return !isEnforceEnabled();
}

function auditPlatformOnly(req, action = 'mutation') {
    const scope = req?.tenantScope;
    if (!scope || scope.mode === 'all') return true;
    auditEvent(req, 'platform_scope_required', { action, scope });
    return !isEnforceEnabled();
}

module.exports = {
    isAuditEnabled,
    isEnforceEnabled,
    rowMatchesScope,
    auditEvent,
    auditIdorCrossTenant,
    auditUnscopedEndpoint,
    auditRowsLeak,
    verifyAndAuditRows,
    checkIdorOnMiss,
    filterRowsToScope,
    auditTenantResourceAccess,
    auditPlatformOnly,
};
