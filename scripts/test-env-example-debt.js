#!/usr/bin/env node
'use strict';

/**
 * SP-10 — .env.example marca envs mortos / TECH_DEBT.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const env = fs.readFileSync(path.join(__dirname, '../.env.example'), 'utf8');

const DEAD = [
  'GOOGLE_SHEETS',
  'USE_LOCAL_AI',
  'OLLAMA_',
  'DB_TYPE',
  'DATABASE_URL',
  'CACHE_TTL',
  'SESSION_TTL',
  'TOKEN_MP_ASSINATURA',
];

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

console.log('\n=== .env.example debt markers (SP-10) ===\n');

test('header referencia TECH_DEBT', () => {
  assert.ok(env.includes('TECH_DEBT'), 'header deve mencionar TECH_DEBT');
});

for (const key of DEAD) {
  test(`${key} comentado ou marcado`, () => {
    assert.ok(env.includes(key), `falta ${key} em .env.example`);
    const line = env.split('\n').find((l) => l.includes(key));
    assert.ok(
      line.startsWith('#') || /NÃO|NAO|TECH_DEBT/i.test(line),
      `${key} deve estar comentado`
    );
  });
}

console.log(failed ? `\n${failed} falha(s)\n` : '\nOK — env example SP-10\n');
process.exit(failed ? 1 : 0);
