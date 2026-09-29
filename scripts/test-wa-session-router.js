'use strict';

const assert = require('assert');
const { resolveSessionForSlot } = require('../src/plugins/zero-divu/waSessionRouter');

process.env.WA_DUAL_ENABLED = '1';

const cases = [
  { hour: 0, channel: 'telegram_group', expect: 'wa_a' },
  { hour: 6, channel: 'telegram_group', expect: 'wa_a' },
  { hour: 12, channel: 'telegram_group', expect: 'wa_b' },
  { hour: 18, channel: 'telegram_group', expect: 'wa_b' },
  { hour: 8, channel: 'telegram_pv', expect: 'wa_a' },
  { hour: 18, channel: 'telegram_pv', expect: 'wa_b' },
];

for (const c of cases) {
  const got = resolveSessionForSlot(c.hour, c.channel);
  assert.strictEqual(got, c.expect, `${c.hour} ${c.channel} → ${got} (expected ${c.expect})`);
}

console.log(`OK ${cases.length} slot→session mappings`);
