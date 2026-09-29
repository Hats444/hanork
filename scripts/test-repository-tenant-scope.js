#!/usr/bin/env node
'use strict';

/**
 * Fase 2 SaaS — enforcement tenant_id nos repositórios (BaseRepository + tenantScope).
 */
const path = require('path');
process.chdir(path.join(__dirname, '..'));

const assert = require('assert');
const { appendTenantWhere, getScopeFromContext, tenantSql } = require('../src/modules/tenant/tenantScope');
const BaseRepository = require('../src/infrastructure/BaseRepository');
const tenantContext = require('../src/infrastructure/TenantContext');
const { legacyTenant, platformTenant, normalizeRow } = require('../src/modules/tenant/tenantResolver');

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

console.log('\n=== Repository tenant scope (Fase 2) ===\n');

test('tenantSql legacy → IS NULL', () => {
    const t = tenantSql('tenant_id', { mode: 'legacy', tenantId: null });
    assert.ok(t.clause.includes('IS NULL'));
    assert.strictEqual(t.params.length, 0);
});

test('tenantSql tenant → = ?', () => {
    const t = tenantSql('tenant_id', { mode: 'tenant', tenantId: 7 });
    assert.ok(t.clause.includes('= ?'));
    assert.deepStrictEqual(t.params, [7]);
});

test('tenantSql platform → 1=1', () => {
    const t = tenantSql('tenant_id', { mode: 'platform', tenantId: null });
    assert.strictEqual(t.clause, '1=1');
});

test('appendTenantWhere adiciona AND em SELECT existente', () => {
    const r = appendTenantWhere('SELECT * FROM orders WHERE status = ?', ['PAID']);
    assert.ok(r.sql.includes('status = ?'));
    assert.ok(r.sql.includes('tenant_id IS NULL'));
    assert.deepStrictEqual(r.params, ['PAID']);
});

test('appendTenantWhere tenant mode', () => {
    const r = appendTenantWhere(
        'SELECT * FROM products WHERE active = 1',
        [],
        'tenant_id',
        { mode: 'tenant', tenantId: 3 }
    );
    assert.ok(r.sql.includes('tenant_id = ?'));
    assert.deepStrictEqual(r.params, [3]);
});

test('BaseRepository._tenantClause qualificado', () => {
    const repo = new BaseRepository('products');
    const tc = repo._tenantClause('p.tenant_id');
    assert.ok(tc.clause.includes('p.tenant_id'));
});

test('BaseRepository legacy filtra IS NULL em find SQL', () => {
    const repo = new BaseRepository('orders');
    const { sql } = repo._applyTenant('SELECT * FROM orders', []);
    assert.ok(sql.includes('tenant_id IS NULL'));
});

(async () => {
    const legacy = legacyTenant();
    await tenantContext.runAs(legacy.id, async () => {
        const scope = getScopeFromContext();
        assert.strictEqual(scope.mode, 'legacy');
        const repo = new BaseRepository('users');
        const { sql } = repo._applyTenant('SELECT * FROM users WHERE id = ?', [1]);
        assert.ok(sql.includes('tenant_id IS NULL'), 'legacy scope no ALS');
    });

    const platform = platformTenant();
    await tenantContext.runAs(platform.id, async () => {
        const repo = new BaseRepository('products');
        const { sql } = repo._applyTenant('SELECT * FROM products', []);
        assert.ok(!sql.includes('tenant_id IS NULL') && !sql.includes('tenant_id = ?'), 'platform sem filtro');
    });

    test('AsyncLocalStorage + tenantScope integrados', () => {});
    console.log(`\n=== Resultado: ${failed ? 'FALHOU' : 'OK'} (${failed} falhas) ===\n`);
    process.exit(failed ? 1 : 0);
})().catch((e) => {
    console.error('  FAIL ALS:', e.message);
    process.exit(1);
});
