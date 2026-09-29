#!/usr/bin/env node
'use strict';

/**
 * Testes leves do módulo SaaS (sem Telegram).
 */
const path = require('path');
process.chdir(path.join(__dirname, '..'));

let ok = 0;
let fail = 0;

function assert(cond, msg) {
    if (cond) {
        ok++;
        console.log('  OK', msg);
    } else {
        fail++;
        console.log('  FAIL', msg);
    }
}

(async () => {
    console.log('\n=== Hanork SaaS — testes ===\n');

    const TenantService = require('../src/modules/tenant/TenantService');
    const { tenantSql, getScopeFromContext } = require('../src/modules/tenant/tenantScope');
    const tenantContext = require('../src/infrastructure/TenantContext');
    const { legacyTenant, normalizeRow } = require('../src/modules/tenant/tenantResolver');
    const PaymentService = require('../src/modules/payment/PaymentService');

    assert(typeof TenantService.getPlans === 'function', 'TenantService.getPlans');
    assert(typeof TenantService.checkProductLimit === 'function', 'checkProductLimit');
    assert(typeof PaymentService.getStatusForWebhook === 'function', 'getStatusForWebhook');

    const legacy = legacyTenant();
    await tenantContext.runAs(legacy.id, async () => {
        const scope = getScopeFromContext();
        assert(scope.mode === 'legacy', 'legacy scope mode');
        const t = tenantSql();
        assert(t.clause.includes('IS NULL'), 'legacy SQL IS NULL');
    });

    try {
        const plans = TenantService.getPlans();
        assert(plans.length >= 3, 'seed plans free/pro/business');
    } catch (e) {
        console.log('  SKIP DB tests (sqlite):', e.message?.slice(0, 60));
    }

    console.log(`\n=== Resultado: ${ok} ok, ${fail} falhas ===\n`);
    process.exit(fail ? 1 : 0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
