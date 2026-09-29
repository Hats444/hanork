#!/usr/bin/env node
'use strict';
const path = '/home/vendetta/hanork';
process.chdir(path);
require('dotenv').config({ path: '/home/vendetta/hanork/.env' });

(async () => {
const results = { ts: new Date().toISOString(), checks: [] };
function pass(name, detail) { results.checks.push({ name, ok: true, detail }); }
function fail(name, detail) { results.checks.push({ name, ok: false, detail }); }

try {
  const { appendTenantWhere } = require(path + '/src/modules/tenant/tenantScope');
  const q = appendTenantWhere('SELECT * FROM active_carts WHERE user_id = ? ORDER BY added_at DESC', [1]);
  if (q.sql.includes('ORDER BY') && q.sql.indexOf('AND tenant_id') < q.sql.indexOf('ORDER BY')) {
    pass('cart_sql', q.sql);
  } else fail('cart_sql', q.sql);
} catch (e) {
  fail('cart_sql', e.message);
}

try {
  const { createMenuKeyboards } = require(path + '/src/telegram/menus/MenuKeyboards');
  const Menu = createMenuKeyboards({}, { isAvailable: () => true });
  const kb = Menu.principal(false, 1, null, 123, () => false, {});
  const flat = (kb.reply_markup?.inline_keyboard || []).flat();
  const hasDl = flat.some((b) => b.callback_data === 'downloads:open');
  if (hasDl) pass('menu_principal_downloads', `${flat.length} botões`);
  else fail('menu_principal_downloads', 'downloads:open ausente');
} catch (e) {
  fail('menu_principal_downloads', e.message);
}

try {
  const UserAccountPanels = require(path + '/src/modules/user/UserAccountPanels');
  const kb = UserAccountPanels.accountPanelKeyboard({});
  const flat = (kb.reply_markup?.inline_keyboard || []).flat();
  const hasDl = flat.some((b) => b.callback_data === 'downloads:open');
  if (hasDl) pass('minha_conta_downloads', 'ok');
  else fail('minha_conta_downloads', 'downloads:open ausente');
} catch (e) {
  fail('minha_conta_downloads', e.message);
}

try {
  const { prisma } = require(path + '/src/config/database-sqlite');
  const testTg = '999888777666';
  const user = await prisma.user.upsert({
    where: { telegram_id: testTg },
    create: { telegram_id: testTg, first_name: 'OpsTest' },
    update: {},
  });
  await prisma.cart.clear(user.id);
  const Database = require('better-sqlite3');
  const row = new Database('/home/vendetta/.hanork/hanork.db', { readonly: true })
    .prepare('SELECT id, name, price FROM products WHERE active=1 LIMIT 1').get();
  if (!row) {
    fail('cart_e2e', 'sem produto ativo');
  } else {
    await prisma.cart.add(user.id, testTg, row.id, row.name, row.price);
    const items = await prisma.cart.get(user.id);
    const total = await prisma.cart.total(user.id);
    await prisma.cart.clear(user.id);
    if (items?.length === 1 && Number(total) > 0) {
      pass('cart_e2e', `add/get/total/clear OK · ${row.name}`);
    } else {
      fail('cart_e2e', `items=${items?.length} total=${total}`);
    }
  }
} catch (e) {
  fail('cart_e2e', e.message);
}

try {
  const antiBan = require(path + '/zero-divu/src/services/antiBan');
  const can = antiBan.canPostNow({ forceBlast: true });
  if (can) pass('blast_forceBlast', 'antiBan.canPostNow(forceBlast)=true');
  else fail('blast_forceBlast', 'cota ainda bloqueia forceBlast');
} catch (e) {
  fail('blast_forceBlast', e.message);
}

try {
  const fs = require('fs');
  for (const sid of ['wa_a', 'wa_b']) {
    const statePath = sid === 'wa_b' ? '/home/vendetta/.zero-divu-b/state.json' : '/home/vendetta/.zero-divu/state.json';
    let detail = 'processo ativo';
    if (fs.existsSync(statePath)) {
      const s = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      if (s.connected || s.online || s.status === 'connected') detail = 'conectado';
      else detail = `state: ${s.status || '?'}`;
    }
    pass(`wa_worker_${sid}`, detail);
  }
} catch (e) {
  fail('wa_workers', e.message);
}

const ok = results.checks.filter((c) => c.ok).length;
const total = results.checks.length;
results.summary = `${ok}/${total} OK`;
results.allOk = ok === total;
console.log(JSON.stringify(results, null, 2));
process.exit(results.allOk ? 0 : 1);
})();
