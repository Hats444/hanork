'use strict';

const assert = require('assert');
const { listPromoTargetSessions } = require('../src/plugins/zero-divu/waPromoFanout');
const { resolveSessionsForPromo } = require('../src/plugins/zero-divu/waSessionRouter');

process.env.WA_DUAL_ENABLED = '1';

const dual = listPromoTargetSessions();
assert.ok(dual.length >= 2, `dual deve listar 2+ sessões, got ${dual.length}`);
assert.deepStrictEqual(resolveSessionsForPromo(), dual);

process.env.WA_PROMO_PRIMARY_ONLY = '1';
const single = listPromoTargetSessions();
assert.strictEqual(single.length, 1);

delete process.env.WA_PROMO_PRIMARY_ONLY;
assert.strictEqual(listPromoTargetSessions({ sessionId: 'wa_b' }).join(), 'wa_b');

console.log(`OK promo fan-out: dual=[${dual.join(',')}] primary-only=1 sessão`);
