#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const code = fs.readFileSync(path.join(__dirname, '../public/js/admin-utils.js'), 'utf8');
const ctx = { window: {}, document: { cookie: '' } };
ctx.window = ctx;
vm.runInContext(code, vm.createContext(ctx));
const { esc, escAttr, escUrl } = ctx.window.HanorkAdminUtils;

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

console.log('\n=== admin-utils (HTML escape) ===\n');

test('esc neutraliza tags e entidades', () => {
  assert.strictEqual(esc('<script>"&'), '&lt;script&gt;&quot;&amp;');
  assert.strictEqual(esc(null), '');
});

test('escAttr escapa aspas simples', () => {
  assert.strictEqual(escAttr("a'b"), 'a&#39;b');
});

test('escUrl só aceita http(s)', () => {
  assert.strictEqual(escUrl('https://x.com/a?b=1'), 'https://x.com/a?b=1');
  assert.strictEqual(escUrl('javascript:alert(1)'), '');
  assert.strictEqual(escUrl('//evil.com'), '');
});

test('getCsrfToken lê cookie dashboard_csrf', () => {
  const { getCsrfToken } = ctx.window.HanorkAdminUtils;
  ctx.document.cookie = 'dashboard_csrf=abc123';
  assert.strictEqual(getCsrfToken(), 'abc123');
  ctx.document.cookie = '';
});

process.exit(failed ? 1 : 0);
