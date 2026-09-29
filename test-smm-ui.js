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
const { CB, platformSlug, subSlug, platformFromSlug, subFromSlug } = require('../src/modules/smm/utils/smmCallbackData');
const { platformKeyboard } = require('../src/modules/smm/keyboards/smmCatalogKeyboards');
const { PLATFORM_ICONS } = require('../src/modules/smm/utils/smmTextFormat');
const CatalogService = require('../src/modules/smm/services/catalogService');

(async () => {
console.log('\n=== SMM UI (Onda B) ===\n');

connect();

assert(CB.HOME === 'smm:home', 'CB.HOME');
assert(CB.platform('ig') === 'smm:p:ig', 'platform callback');
assert(CB.list('ig', 'seg', 2) === 'smm:l:ig:seg:2', 'list callback');

assert(platformFromSlug('ig') === 'Instagram', 'decode platform');
assert(subFromSlug('seg') === 'Seguidores', 'decode sub');

const stats = await CatalogService.stats();
assert(stats.total >= 3668, `catalog imported (${stats.total})`);

const plats = await CatalogService.getPlatforms();
assert(plats.length > 0, 'platforms list');

const igSubs = CatalogService.listSubcategories('Instagram');
assert(igSubs.length > 0, 'instagram subcategories');

const list = CatalogService.listServices('Instagram', 'Seguidores', 0);
assert(list.items.length > 0, 'service list page');

const search = CatalogService.search('curtidas tiktok', 5);
assert(search.length > 0, 'search results');

assert(PLATFORM_ICONS.Instagram === '📷', 'PLATFORM_ICONS.Instagram');
const kb = platformKeyboard([{ platform: 'Instagram', total: 42 }]);
const igBtn = kb.reply_markup.inline_keyboard.flat().find((b) => b.callback_data === CB.platform('ig'));
assert(igBtn && igBtn.text.includes('Instagram'), 'platformKeyboard instagram button');

console.log(`\n${ok} ok, ${fail} fail\n`);
process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
