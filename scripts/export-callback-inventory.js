#!/usr/bin/env node
'use strict';

/**
 * B2 U1 — Inventário CSV de callbacks (amostras estáticas do código).
 * Uso: node scripts/export-callback-inventory.js > callback-inventory.csv
 */
require('../src/config/env');

const fs = require('fs');
const path = require('path');
const hanorkGateway = require('../src/core/hanorkGateway');
const { registry } = require('../src/core/CallbackRegistry');
const { AllHandlers } = require('../src/core/UserHandlers');

const SRC = path.join(__dirname, '../src');

function walk(dir, files = []) {
    for (const name of fs.readdirSync(dir)) {
        const p = path.join(dir, name);
        const st = fs.statSync(p);
        if (st.isDirectory()) {
            if (name !== 'node_modules') walk(p, files);
        } else if (name.endsWith('.js')) files.push(p);
    }
    return files;
}

function extractCallbacks(content) {
    const found = new Set();
    const re = /callback_data:\s*(?:`([^`$]+(?:\$\{[^}]+\}[^`]*)*)`|'([^']+)'|"([^"]+)")/g;
    let m;
    while ((m = re.exec(content))) {
        const raw = m[1] || m[2] || m[3];
        if (!raw) continue;
        if (raw.includes('${')) {
            const numeric = raw.replace(/\$\{[^}]+\}/g, '1');
            if (numeric) found.add(numeric);
        } else {
            found.add(raw);
        }
    }
    return found;
}

function csvEscape(value) {
    const s = String(value ?? '');
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
}

registry.clear();
for (const [pattern, handler] of Object.entries(AllHandlers)) {
    registry.register(pattern, handler);
}

const allCallbacks = new Set();
for (const file of walk(SRC)) {
    const content = fs.readFileSync(file, 'utf8');
    for (const cb of extractCallbacks(content)) allCallbacks.add(cb);
}

const rows = [['callback_sample', 'normalized', 'predicted_route', 'intent_id', 'critical']];

for (const cb of [...allCallbacks].sort()) {
    const p = hanorkGateway.predictCallbackRoute(cb, registry);
    rows.push([
        cb,
        p.normalized,
        p.route,
        p.intentId,
        p.critical ? 'yes' : 'no',
    ]);
}

const out = rows.map((r) => r.map(csvEscape).join(',')).join('\n');
console.log(out);
console.error(`\n# ${rows.length - 1} callbacks (stderr)`);
