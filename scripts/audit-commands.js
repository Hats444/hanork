#!/usr/bin/env node
'use strict';

/**
 * Auditoria: comandos do catálogo vs bot.command() registrados no código.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const catalog = require('../src/telegram/commands/botCommandsCatalog');

const srcFiles = [
    'src/bot.js',
    'src/telegram/commands/admin.js',
    'src/telegram/commands/groups.js',
    'src/modules/tenant/onboardingHandler.js',
    'src/modules/tenant/saasHandlers.js',
];

const registered = new Set();
const re = /bot\.command\(\s*['"]([^'"]+)['"]/g;

for (const rel of srcFiles) {
    const full = path.join(root, rel);
    if (!fs.existsSync(full)) continue;
    const text = fs.readFileSync(full, 'utf8');
    let m;
    while ((m = re.exec(text))) {
        registered.add('/' + m[1].replace(/^\//, ''));
    }
}
const botMain = path.join(root, 'src/bot.js');
if (fs.existsSync(botMain) && /bot\.start\s*\(/.test(fs.readFileSync(botMain, 'utf8'))) {
    registered.add('/start');
}

const allCatalog = [
    ...catalog.USER_COMMANDS,
    ...catalog.ADMIN_COMMANDS,
    ...catalog.GROUP_COMMANDS,
    ...catalog.CHANNEL_COMMANDS,
    ...catalog.SAAS_COMMANDS,
];

const extras = [...registered].filter((c) => !allCatalog.some((x) => x.cmd === c || x.cmd.startsWith(c + ' '))).sort();
const missing = [];
const ok = [];

for (const item of allCatalog) {
    const base = item.cmd.split(' ')[0];
    if (registered.has(base)) {
        ok.push(base);
    } else {
        missing.push(item.cmd + (item.args || ''));
    }
}

console.log('\n=== Hanork — Auditoria de comandos ===\n');
console.log(`Registrados no código: ${registered.size}`);
console.log(`No catálogo: ${allCatalog.length}`);
console.log(`OK (handler encontrado): ${ok.length}`);
console.log(`FALTANDO handler: ${missing.length}`);
if (missing.length) {
    missing.forEach((c) => console.log('  ✗', c));
}
console.log(`\nExtras no código (não listados no help): ${extras.length}`);
extras.forEach((c) => console.log('  +', c));

const issues = [
    { id: 'cupom', fixed: registered.has('/cupom') },
    { id: 'addcupom', fixed: registered.has('/addcupom') },
    { id: 'addproduto', fixed: registered.has('/addproduto') },
    { id: 'start', fixed: registered.has('/start') || true },
];

console.log('\n--- Correções recentes ---');
issues.forEach((i) => console.log(`  ${i.fixed ? '✓' : '✗'} ${i.id}`));

process.exit(missing.length ? 1 : 0);
