#!/usr/bin/env node
'use strict';
/**
 * Fase 2 — prisma layer tenant enforcement (database-sqlite.js)
 */
const path = require('path');
process.chdir(path.join(__dirname, '..'));

const assert = require('assert');
const { prisma, connect } = require('../src/config/database-sqlite');
const tenantContext = require('../src/infrastructure/TenantContext');
const { legacyTenant, platformTenant } = require('../src/modules/tenant/tenantResolver');
const { rowInScope, shouldBypassTenantFilter } = require('../src/modules/tenant/tenantScope');

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

console.log('\n=== Prisma tenant scope (Fase 2 completa) ===\n');

test('shouldBypassTenantFilter order by id', () => {
    assert.strictEqual(shouldBypassTenantFilter('orders', { id: 'abc' }), true);
});

test('shouldBypassTenantFilter order by status (recovery)', () => {
    assert.strictEqual(shouldBypassTenantFilter('orders', { status: 'WAITING_PAYMENT' }), true);
});

test('rowInScope legacy rejects tenant row', () => {
    tenantContext.storage.run(legacyTenant(), () => {
        assert.strictEqual(rowInScope({ tenant_id: 5 }), null);
        assert.ok(rowInScope({ tenant_id: null }));
    });
});

(async () => {
    const db = connect();
    db.prepare('DELETE FROM products WHERE name LIKE ?').run('__tenant_test_%');

    const legacy = legacyTenant();
    let legacyId;
    await tenantContext.runAs(legacy.id, async () => {
        const p = prisma.product.create({
            data: { name: '__tenant_test_legacy', price: 1, active: true },
        });
        legacyId = p.id;
        const all = prisma.product.findMany({ where: { active: 1 } });
        assert.ok(all.some((x) => x.id === legacyId), 'legacy vê produto legacy');
    });

    await tenantContext.runAs(legacy.id, async () => {
        const rows = prisma.product.findMany({ where: { active: 1 } });
        const leaked = rows.filter((r) => r.name === '__tenant_test_t7');
        assert.strictEqual(leaked.length, 0, 'legacy não vê produto de outro tenant');
    });

    const platform = platformTenant();
    await tenantContext.runAs(platform.id, async () => {
        const rows = prisma.product.findMany({ where: { active: 1 } });
        assert.ok(rows.some((r) => r.id === legacyId), 'platform vê produto legacy');
    });

    db.prepare('DELETE FROM products WHERE name LIKE ?').run('__tenant_test_%');

    console.log(`\n=== Resultado: ${failed ? 'FALHOU' : 'OK'} (${failed} falhas) ===\n`);
    process.exit(failed ? 1 : 0);
})().catch((e) => {
    console.error('  FAIL async:', e.message);
    process.exit(1);
});
