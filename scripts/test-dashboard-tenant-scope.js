#!/usr/bin/env node
'use strict';

/**
 * SEC-C1 / SEC-C2 — escopo tenant no dashboard (mutations + analytics SQL).
 */
require('../src/config/env');

const assert = require('assert');
const {
    clause,
    validateDashboardTenantSwitch,
    requireMutationScope,
} = require('../src/modules/dashboard/dashboardTenant');

let failed = 0;
function test(name, fn) {
    try {
        fn();
        console.log('  OK', name);
    } catch (e) {
        failed++;
        console.error('  FAIL', name + ':', e.message);
    }
}

console.log('\n=== Dashboard tenant scope (SEC-C1) ===\n');

test('legacy clause → tenant_id IS NULL', () => {
    const t = clause('tenant_id', { mode: 'legacy', tenantId: null });
    assert.ok(t.sql.includes('IS NULL'));
    assert.strictEqual(t.params.length, 0);
});

test('tenant clause → tenant_id = ?', () => {
    const t = clause('tenant_id', { mode: 'tenant', tenantId: 5 });
    assert.ok(t.sql.includes('= ?'));
    assert.deepStrictEqual(t.params, [5]);
});

test('all clause → sem filtro', () => {
    const t = clause('tenant_id', { mode: 'all', tenantId: null });
    assert.strictEqual(t.sql, '');
    assert.strictEqual(t.params.length, 0);
});

test('UPDATE produto cross-tenant: legacy não altera tenant 5', () => {
    const pt = clause('tenant_id', { mode: 'legacy', tenantId: null });
    const sql = `UPDATE products SET active=0 WHERE id=?${pt.sql}`;
    assert.ok(sql.includes('tenant_id IS NULL'));
});

test('DELETE cupom scoped tenant 5', () => {
    const ct = clause('tenant_id', { mode: 'tenant', tenantId: 5 });
    const sql = `DELETE FROM coupons WHERE id=?${ct.sql}`;
    assert.ok(sql.includes('tenant_id = ?'));
    assert.deepStrictEqual(ct.params, [5]);
});

test('analytics orders alias o.tenant_id', () => {
    const ot = clause('tenant_id', { mode: 'tenant', tenantId: 3 }, 'o');
    assert.ok(ot.sql.includes('o.tenant_id'));
    assert.deepStrictEqual(ot.params, [3]);
});

test('validateDashboardTenantSwitch legacy/all', () => {
    assert.strictEqual(validateDashboardTenantSwitch('legacy').ok, true);
    assert.strictEqual(validateDashboardTenantSwitch('all').ok, true);
});

test('validateDashboardTenantSwitch id inválido', () => {
    assert.strictEqual(validateDashboardTenantSwitch('abc').ok, false);
});

test('requireMutationScope bloqueia mode all (SEC-C1)', () => {
    const r = requireMutationScope({ mode: 'all', tenantId: null });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.status, 403);
});

test('groups query filtra tenant_id', () => {
    const gt = clause('tenant_id', { mode: 'tenant', tenantId: 7 }, 'g');
    const sql = `SELECT g.* FROM telegram_groups g WHERE g.active=1${gt.sql}`;
    assert.ok(sql.includes('g.tenant_id = ?'));
    assert.deepStrictEqual(gt.params, [7]);
});

test('requireMutationScope permite legacy e tenant', () => {
    assert.strictEqual(requireMutationScope({ mode: 'legacy', tenantId: null }).ok, true);
    assert.strictEqual(requireMutationScope({ mode: 'tenant', tenantId: 2 }).ok, true);
});

const {
    rowMatchesScope,
    verifyAndAuditRows,
    isAuditEnabled,
    isEnforceEnabled,
} = require('../src/modules/dashboard/dashboardTenantAudit');
const { clauseInline } = require('../src/modules/dashboard/dashboardTenant');

test('rowMatchesScope legacy aceita tenant_id null', () => {
    assert.strictEqual(rowMatchesScope({ tenant_id: null }, { mode: 'legacy', tenantId: null }), true);
    assert.strictEqual(rowMatchesScope({ tenant_id: 5 }, { mode: 'legacy', tenantId: null }), false);
});

test('rowMatchesScope tenant exige id igual', () => {
    assert.strictEqual(rowMatchesScope({ tenant_id: 3 }, { mode: 'tenant', tenantId: 3 }), true);
    assert.strictEqual(rowMatchesScope({ tenant_id: 2 }, { mode: 'tenant', tenantId: 3 }), false);
});

test('verifyAndAuditRows não remove linhas em modo audit', () => {
    const prev = process.env.DASHBOARD_TENANT_ENFORCE;
    process.env.DASHBOARD_TENANT_ENFORCE = '0';
    const rows = verifyAndAuditRows(
        { tenantScope: { mode: 'tenant', tenantId: 1 }, path: '/api/v1/products' },
        [{ id: 1, tenant_id: 2 }],
        { mode: 'tenant', tenantId: 1 },
        'products'
    );
    assert.strictEqual(rows.length, 1);
    process.env.DASHBOARD_TENANT_ENFORCE = prev;
});

test('clauseInline subquery orders tenant 4', () => {
    const sql = clauseInline('tenant_id', { mode: 'tenant', tenantId: 4 });
    assert.ok(sql.includes('tenant_id = 4'));
});

test('verifyAndAuditRows remove linhas em modo enforce', () => {
    const prev = process.env.DASHBOARD_TENANT_ENFORCE;
    process.env.DASHBOARD_TENANT_ENFORCE = '1';
    const rows = verifyAndAuditRows(
        { tenantScope: { mode: 'tenant', tenantId: 1 }, path: '/api/v1/products' },
        [
            { id: 1, tenant_id: 1 },
            { id: 2, tenant_id: 9 },
        ],
        { mode: 'tenant', tenantId: 1 },
        'products'
    );
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].id, 1);
    process.env.DASHBOARD_TENANT_ENFORCE = prev;
});

test('auditTenantResourceAccess bloqueia cross-tenant em enforce', () => {
    const { auditTenantResourceAccess } = require('../src/modules/dashboard/dashboardTenantAudit');
    const prev = process.env.DASHBOARD_TENANT_ENFORCE;
    process.env.DASHBOARD_TENANT_ENFORCE = '1';
    const ok = auditTenantResourceAccess(
        { tenantScope: { mode: 'tenant', tenantId: 2 } },
        5,
        5
    );
    assert.strictEqual(ok, false);
    process.env.DASHBOARD_TENANT_ENFORCE = prev;
});

test('auditPlatformOnly bloqueia mutation fora de visão plataforma em enforce', () => {
    const { auditPlatformOnly } = require('../src/modules/dashboard/dashboardTenantAudit');
    const prev = process.env.DASHBOARD_TENANT_ENFORCE;
    process.env.DASHBOARD_TENANT_ENFORCE = '1';
    const ok = auditPlatformOnly({ tenantScope: { mode: 'tenant', tenantId: 1 } }, 'tenant_update');
    assert.strictEqual(ok, false);
    process.env.DASHBOARD_TENANT_ENFORCE = prev;
});

test('flags audit/enforce parse', () => {
    const prevA = process.env.DASHBOARD_TENANT_AUDIT;
    const prevE = process.env.DASHBOARD_TENANT_ENFORCE;
    process.env.DASHBOARD_TENANT_AUDIT = '1';
    process.env.DASHBOARD_TENANT_ENFORCE = '0';
    assert.strictEqual(isAuditEnabled(), true);
    assert.strictEqual(isEnforceEnabled(), false);
    process.env.DASHBOARD_TENANT_AUDIT = prevA;
    process.env.DASHBOARD_TENANT_ENFORCE = prevE;
});

console.log(failed ? `\n${failed} falha(s)\n` : '\nOK — dashboard tenant scope\n');
process.exit(failed ? 1 : 0);
