#!/usr/bin/env node
'use strict';

/**
 * Gera hash bcrypt para DASHBOARD_PASS_HASH
 * Uso: node scripts/hash-dashboard-pass.js "sua_senha"
 */
const bcrypt = require('bcryptjs');

const pass = process.argv[2];
if (!pass) {
  console.error('Uso: node scripts/hash-dashboard-pass.js "sua_senha"');
  process.exit(1);
}

const hash = bcrypt.hashSync(pass, 12);
console.log('\nCole no .env:\n');
console.log(`DASHBOARD_PASS_HASH=${hash}`);
console.log('\nRemova ou comente DASHBOARD_PASS após configurar o hash.\n');
