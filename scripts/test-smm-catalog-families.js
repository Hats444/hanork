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
const CatalogService = require('../src/modules/smm/services/catalogService');
const { familyDisplayLabel, pickBestPerFamily } = require('../src/modules/smm/services/familyService');
const SmmServiceRepository = require('../src/modules/smm/repositories/smmServiceRepository');

(async () => {
    console.log('\n=== SMM catalog families (V2 onda F) ===\n');

    connect();

    const all = SmmServiceRepository.listAllByPlatformSub('Instagram', 'Seguidores');
    assert(all.length > 0, 'raw services in Instagram/Seguidores');

    const families = pickBestPerFamily(all);
    assert(families.length > 0, 'pickBestPerFamily returns items');
    assert(families.length <= all.length, 'families <= raw rows');

    const familyIds = new Set(families.map((f) => f.service_family));
    assert(familyIds.size === families.length, 'one row per family');

    const list = CatalogService.listFamilies('Instagram', 'Seguidores', 0);
    assert(list.items.length > 0, 'listFamilies page');
    assert(list.items.length === Math.min(list.pageSize, list.totalFamilies), 'page size');
    assert(typeof list.totalFamilies === 'number', 'totalFamilies count');

    const dupFamilies = list.items.map((i) => i.service_family);
    assert(new Set(dupFamilies).size === dupFamilies.length, 'no duplicate families on page');

    const sample = list.items[0];
    const label = familyDisplayLabel(sample.service_family, sample.subcategory);
    assert(label.includes('Seguidores'), 'familyDisplayLabel readable');
    assert(!label.includes('#'), 'label hides provider noise');

    const best = CatalogService.getFamilyRepresentative(sample.service_family);
    assert(!!best && best.service_family === sample.service_family, 'getFamilyRepresentative');

    console.log(`\n${ok} ok, ${fail} fail\n`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
