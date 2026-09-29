'use strict';

const assert = require('assert');
const GptQueue = require('../src/services/GptRequestQueue');
const { getProductPromoBody, hasPromoTemplate, withPromoTemplate } = require('../src/data/productPromoTemplates');
const { buildWaPlainPromo } = require('../src/utils/persuasiveProductCopy');
const { shouldDeferAiForChannel } = require('../src/utils/broadcastAiCopy');

let passed = 0;

function ok(cond, msg) {
  if (!cond) throw new Error(msg);
  passed++;
  console.log('OK', msg);
}

(async () => {
  for (const id of [15]) {
    const body = getProductPromoBody({ id, name: `prod-${id}` });
    ok(body.length > 80, `template produto ${id} tem corpo profissional`);
  }

  ok(!hasPromoTemplate({ id: 999 }), 'produto inexistente sem template');

  const wa = buildWaPlainPromo(withPromoTemplate({ id: 15, name: 'hanork', price: 250 }), {
    username: 'hanork_bot',
  });
  ok(/Hanork Bot v3\.0|catálogo|carrinho/i.test(wa), 'fallback WA hanork usa template rico');
  ok(wa.includes('t.me/hanork_bot?start=buy_15'), 'fallback WA mantém link de compra');

  ok(shouldDeferAiForChannel('tg') === true, 'TG adia IA quando fila não está idle (boot)');

  GptQueue.setBootComplete();
  await new Promise((r) => setTimeout(r, 50));
  const stats = GptQueue.getStats();
  ok(typeof stats.waPending === 'number', 'stats expõe waPending');
  ok(typeof stats.tgAiIdle === 'boolean', 'stats expõe tgAiIdle');

  console.log(`\n${passed} checks passed`);
})().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
