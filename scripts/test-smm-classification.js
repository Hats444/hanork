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

const { classifyService } = require('../src/modules/smm/services/classificationService');
const { computeSalePrice } = require('../src/modules/smm/services/pricingService');
const { normalizeRawService } = require('../src/modules/smm/services/syncService');

console.log('\n=== SMM classification + pricing ===\n');

const ig = classifyService({ name: 'Instagram - Seguidores Brasileiros', category: 'Novos' });
assert(ig.platform === 'Instagram', 'platform Instagram');
assert(ig.subcategory === 'Seguidores', 'sub Seguidores');

const tt = classifyService({ name: 'TikTok - Curtidas Mundiais', category: 'x' });
assert(tt.platform === 'TikTok' && tt.subcategory === 'Curtidas', 'TikTok Curtidas');

const sale = computeSalePrice(10);
assert(sale === Math.max(10 + 2, 10 * 1.35), 'sale price MAX rule');

const row = normalizeRawService({
    service: 99999,
    name: 'YouTube - Visualizações',
    rate: '3.81',
    min: 100,
    max: 1000,
    refill: false,
    cancel: true,
    type: 'Default',
    category: 'Test',
});
assert(row && row.platform === 'YouTube', 'normalize platform');
assert(row.sale_price > row.cost_price, 'sale > cost');

console.log(`\n${ok} ok, ${fail} fail\n`);
process.exit(fail ? 1 : 0);
