#!/usr/bin/env node
'use strict';

const path = require('path');
process.chdir(path.join(__dirname, '..'));
require('../src/config/env');

process.env.SMM_ENABLED = '1';

let ok = 0;
let fail = 0;

function assert(cond, msg) {
    if (cond) { ok++; console.log('  OK', msg); }
    else { fail++; console.log('  FAIL', msg); }
}

const { connect } = require('../src/config/database-sqlite');
const {
    deriveHealthFromCounts,
    recalcServiceHealth,
    runServiceHealthJob,
} = require('../src/modules/smm/services/serviceHealthService');
const { SERVICE_HEALTH, isFulfillHealth, isCatalogHealth } = require('../src/modules/smm/constants/serviceHealthStatuses');
const { resolveFulfillCandidates } = require('../src/modules/smm/services/familyResolverService');
const SmmServiceRepository = require('../src/modules/smm/repositories/smmServiceRepository');

(async () => {
    console.log('\n=== SMM service health (V2 onda D) ===\n');

    connect();

    const healthy = deriveHealthFromCounts({ completed: 10, failed: 0, canceled: 0 });
    assert(healthy.health === SERVICE_HEALTH.HEALTHY, 'low fail rate = HEALTHY');

    const warning = deriveHealthFromCounts({ completed: 7, failed: 2, canceled: 1 });
    assert(warning.health === SERVICE_HEALTH.WARNING, '20% fail = WARNING');

    const degraded = deriveHealthFromCounts({ completed: 5, failed: 3, canceled: 2 });
    assert(degraded.health === SERVICE_HEALTH.DISABLED, '50% fail = DISABLED');

    const db = connect();
    const family = 'test_health_family_d';
    db.prepare('DELETE FROM smm_services WHERE provider_service_id IN (888801, 888802)').run();

    const insert = db.prepare(`
        INSERT INTO smm_services (
            provider, provider_service_id, platform, subcategory, name, service_type,
            cost_price, sale_price, min_quantity, max_quantity, refill, cancel, dripfeed,
            active, service_family, service_score, service_health
        ) VALUES ('fornecedorbrasil', ?, 'Instagram', 'Seguidores', ?, 'Default',
            5, 12, 10, 5000, 1, 0, 0, 1, ?, 80, ?)
    `);
    insert.run(888801, 'Health Test OK', family, 'HEALTHY');
    insert.run(888802, 'Health Test Bad', family, 'DEGRADED');

    const good = SmmServiceRepository.findByProviderId('fornecedorbrasil', 888801);
    const bad = SmmServiceRepository.findByProviderId('fornecedorbrasil', 888802);
    assert(isFulfillHealth(good) && !isFulfillHealth(bad), 'isFulfillHealth filters DEGRADED');
    assert(isCatalogHealth(good) && !isCatalogHealth(bad), 'isCatalogHealth filters DEGRADED');

    const candidates = resolveFulfillCandidates(bad, 50);
    assert(candidates.length === 1 && candidates[0].id === good.id, 'failover skips DEGRADED');

    const r = recalcServiceHealth(good.id, {
        windowDays: 30,
        minSamples: 3,
        warningRate: 0.15,
        degradedRate: 0.35,
        disableRate: 0.5,
        autoDisable: false,
    });
    assert(r.health === SERVICE_HEALTH.HEALTHY, 'recalc with no orders = HEALTHY');

    const job = await runServiceHealthJob();
    assert(typeof job.checked === 'number', 'health job runs');

    db.prepare('DELETE FROM smm_services WHERE provider_service_id IN (888801, 888802)').run();

    console.log(`\n${ok} ok, ${fail} fail\n`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
