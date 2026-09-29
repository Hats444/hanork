#!/usr/bin/env node
'use strict';

const path = require('path');
process.chdir(path.join(__dirname, '..'));

let ok = 0;
let fail = 0;

function assert(cond, msg) {
    if (cond) { ok++; console.log('  OK', msg); }
    else { fail++; console.log('  FAIL', msg); }
}

const {
    deriveServiceFamily,
    computeStaticServiceScore,
    scoreRowsInFamily,
} = require('../src/modules/smm/services/familyService');
const { normalizeRawService } = require('../src/modules/smm/services/syncService');

console.log('\n=== SMM family + score (V2 onda A) ===\n');

const f1 = deriveServiceFamily({
    platform: 'Instagram',
    subcategory: 'Seguidores',
    name: 'Instagram Seguidores BR #01',
});
const f2 = deriveServiceFamily({
    platform: 'Instagram',
    subcategory: 'Seguidores',
    name: 'Instagram Followers Brasileiros Real',
});
const f3 = deriveServiceFamily({
    platform: 'Instagram',
    subcategory: 'Seguidores',
    name: 'Instagram Followers Worldwide',
});

assert(f1 === f2, 'BR variants same family');
assert(f1 === 'instagram_seguidores_br', 'family slug br');
assert(f3 === 'instagram_seguidores_global', 'family slug global');

const cheap = { refill: true, cancel: true, max_quantity: 50000, cost_price: 5 };
const dear = { refill: false, cancel: false, max_quantity: 1000, cost_price: 12 };
const scored = scoreRowsInFamily([cheap, dear]);
assert(scored[0].service_score > scored[1].service_score, 'cheaper refill scores higher in family');

const row = normalizeRawService({
    service: 406,
    name: 'Instagram - Seguidores Brasileiros',
    rate: '7.19',
    min: 50,
    max: 5000,
    refill: true,
    cancel: false,
    type: 'Default',
    category: 'Instagram',
});
assert(row?.service_family === 'instagram_seguidores_br', 'normalize sets family');
assert(Number(row?.service_score) > 0, 'normalize sets score');

console.log(`\n${ok} ok, ${fail} fail\n`);
process.exit(fail ? 1 : 0);
