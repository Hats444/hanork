#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { countStuckOrders, STUCK_MINUTES } = require('../src/modules/health/orderMetrics');

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log('  OK', name);
  } catch (e) {
    failed++;
    console.error('  FAIL', name + ':', e.message);
  }
}

console.log('\n=== Order metrics (P5-3) ===\n');

test('STUCK_MINUTES respeita env mínimo 5', () => {
  const prev = process.env.METRICS_STUCK_ORDER_MINUTES;
  process.env.METRICS_STUCK_ORDER_MINUTES = '3';
  delete require.cache[require.resolve('../src/modules/health/orderMetrics')];
  const mod = require('../src/modules/health/orderMetrics');
  assert.ok(mod.STUCK_MINUTES >= 5);
  process.env.METRICS_STUCK_ORDER_MINUTES = prev;
  delete require.cache[require.resolve('../src/modules/health/orderMetrics')];
});

test('countStuckOrders agrega gauges', () => {
  const db = {
    prepare(sql) {
      return {
        get() {
          if (sql.includes("status = 'PAID'") && sql.includes('paid_at')) return { c: 2 };
          if (sql.includes("status = 'DELIVERING'")) return { c: 1 };
          if (sql.includes("status = 'WAITING_PAYMENT'")) return { c: 5 };
          if (sql.includes("status = 'PAID'")) return { c: 7 };
          return { c: 0 };
        },
      };
    },
  };
  const r = countStuckOrders(db);
  assert.strictEqual(r.stuckPaid, 2);
  assert.strictEqual(r.stuckDelivering, 1);
  assert.strictEqual(r.waitingPayment, 5);
  assert.strictEqual(r.pendingDelivery, 7);
  assert.strictEqual(r.stuckMinutes, STUCK_MINUTES);
});

console.log(failed ? `\n${failed} falha(s)\n` : '\nOK — order metrics\n');
process.exit(failed ? 1 : 0);
