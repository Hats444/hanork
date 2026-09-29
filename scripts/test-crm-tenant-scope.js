#!/usr/bin/env node
'use strict';

/**
 * SEC-C2 — CRM e stats respeitam tenantScope do dashboard.
 */
const assert = require('assert');
const {
    buildAutoTagDefs,
    orderTenantSql,
    userTenantSql,
    DEFAULT_SCOPE,
} = require('../src/modules/crm/CRMService')._test;

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

console.log('\n=== CRM tenant scope (SEC-C2) ===\n');

test('orderTenantSql legacy → IS NULL', () => {
    const sql = orderTenantSql(DEFAULT_SCOPE);
    assert.ok(sql.includes('IS NULL'));
});

test('orderTenantSql tenant → id numérico', () => {
    const sql = orderTenantSql({ mode: 'tenant', tenantId: 7 });
    assert.ok(sql.includes('tenant_id = 7'));
});

test('userTenantSql tenant filtra usuários', () => {
    const sql = userTenantSql({ mode: 'tenant', tenantId: 3 });
    assert.ok(sql.includes('u.tenant_id = 3'));
});

test('buildAutoTagDefs inclui filtro de pedidos por tenant', () => {
    const defs = buildAutoTagDefs({ mode: 'tenant', tenantId: 2 });
    assert.ok(defs.comprador.includes('o.tenant_id = 2'));
});

test('buildAutoTagDefs all → sem filtro extra em pedidos', () => {
    const defs = buildAutoTagDefs({ mode: 'all', tenantId: null });
    assert.ok(!defs.comprador.includes('tenant_id'));
});

test('CRMService.getSegmentStats expõe scope', () => {
    try {
        const CRMService = require('../src/modules/crm/CRMService');
        const stats = CRMService.getSegmentStats({ mode: 'legacy', tenantId: null });
        assert.ok(typeof stats.total_users === 'number');
        assert.strictEqual(stats.scope.mode, 'legacy');
    } catch (e) {
        if (e.code === 'ERR_DLOPEN_FAILED') {
            console.log('  SKIP getSegmentStats (better-sqlite3 indisponível neste host)');
            return;
        }
        throw e;
    }
});

console.log(failed ? `\n${failed} falha(s)\n` : '\nOK — CRM tenant scope\n');
process.exit(failed ? 1 : 0);
