#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  validateCsrf,
  generateToken,
  isCsrfEnforced,
  requireCsrfForMutations,
} = require('../src/modules/auth/dashboardCsrf');

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

const saved = { ...process.env };

console.log('\n=== Dashboard CSRF (P4-1) ===\n');

test('ativo por padrão', () => {
  delete process.env.DASHBOARD_CSRF;
  assert.strictEqual(isCsrfEnforced(), true);
});

test('validateCsrf aceita header = cookie', () => {
  const t = generateToken();
  const r = validateCsrf({
    headers: { 'x-csrf-token': t },
    cookies: { dashboard_csrf: t },
  });
  assert.strictEqual(r.ok, true);
});

test('validateCsrf rejeita token ausente', () => {
  const r = validateCsrf({ headers: {}, cookies: {} });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.status, 403);
});

test('validateCsrf rejeita mismatch', () => {
  const r = validateCsrf({
    headers: { 'x-csrf-token': generateToken() },
    cookies: { dashboard_csrf: generateToken() },
  });
  assert.strictEqual(r.ok, false);
});

test('desligado com DASHBOARD_CSRF=0', () => {
  process.env.DASHBOARD_CSRF = '0';
  assert.strictEqual(validateCsrf({ headers: {}, cookies: {} }).ok, true);
});

test('middleware ignora GET', () => {
  process.env.DASHBOARD_CSRF = '1';
  let nextCalled = false;
  requireCsrfForMutations({ method: 'GET', headers: {}, cookies: {} }, { status: () => ({ json: () => {} }) }, () => {
    nextCalled = true;
  });
  assert.strictEqual(nextCalled, true);
});

test('middleware bloqueia POST sem token', () => {
  process.env.DASHBOARD_CSRF = '1';
  let statusCode = null;
  requireCsrfForMutations(
    { method: 'POST', headers: {}, cookies: {} },
    { status(c) { statusCode = c; return { json() {} }; } },
    () => {}
  );
  assert.strictEqual(statusCode, 403);
});

process.env = saved;

console.log(failed ? `\n${failed} falha(s)\n` : '\nOK — dashboard CSRF\n');
process.exit(failed ? 1 : 0);
