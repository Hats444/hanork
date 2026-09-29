'use strict';

const { parseDashboardTenant } = require('../dashboard/dashboardTenant');
const { auditUnscopedEndpoint, isAuditEnabled } = require('../dashboard/dashboardTenantAudit');

const UNESCOPED_WHEN_SCOPED = new Set(['/groups']);

function attachDashboardTenant(req, res, next) {
    req.tenantScope = parseDashboardTenant(req);
    next();
}

/** Auditoria IDOR: endpoints sem filtro tenant_id em escopo legacy/tenant (4.1). */
function auditDashboardTenantScope(req, res, next) {
    attachDashboardTenant(req, res, () => {
        if (!isAuditEnabled()) return next();
        const scope = req.tenantScope;
        if (!scope || scope.mode === 'all') return next();
        const base = (req.baseUrl || '') + (req.path || '');
        const tail = base.replace(/^\/api\/v1/, '') || req.path || '';
        const key = tail.startsWith('/') ? tail : `/${tail}`;
        if (UNESCOPED_WHEN_SCOPED.has(key)) {
            auditUnscopedEndpoint(req, `GET ${key} sem tenant_id`);
        }
        next();
    });
}

module.exports = {
    attachDashboardTenant,
    auditDashboardTenantScope,
    parseDashboardTenant,
};
