#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
    normalizeCallbackData,
    delegatePaymentNamespaceToLegacy,
    shouldDelegateToLegacyBotAction,
} = require('../src/telegram/callbacks/legacyPatterns');
const { registry } = require('../src/core/CallbackRegistry');
const { AllHandlers, LegacyMapping } = require('../src/core/UserHandlers');
const { CB } = require('../src/telegram/callbacks/constants');

const SRC = path.join(__dirname, '../src');
const CONTEXT_HANDLERS = {
    [CB.MENU_HOME]: true,
    [CB.CATALOG_VIEW]: true,
    [CB.CART_VIEW]: true,
    [CB.CART_CLEAR]: true,
    [CB.CHECKOUT_START]: true,
    'payment:aff:*': true,
};

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
        if (!raw || raw.includes('${')) {
            // template — amostra numérica (padrão mais comum nos botões)
            const numeric = raw?.replace(/\$\{[^}]+\}/g, '1');
            if (numeric) found.add(numeric);
        } else {
            found.add(raw);
        }
    }
    return found;
}

function resolveHandlerKey(data) {
    const normalized = normalizeCallbackData(data);
    let effective = normalized || data;
    const pay = delegatePaymentNamespaceToLegacy(effective);
    if (pay) effective = pay;

    if (shouldDelegateToLegacyBotAction(effective)) {
        return { route: 'legacy', effective };
    }

    if (AllHandlers[effective] || CONTEXT_HANDLERS[effective]) {
        return { route: 'registry-exact', effective };
    }

    if (LegacyMapping[effective]) {
        return { route: 'registry-alias', effective: LegacyMapping[effective] };
    }

    for (const key of Object.keys({ ...AllHandlers, ...CONTEXT_HANDLERS })) {
        if (!key.includes('*')) continue;
        const prefix = key.replace(':*', ':');
        if (effective.startsWith(prefix)) {
            return { route: 'registry-wildcard', effective, pattern: key };
        }
    }

    for (const key of Object.keys(LegacyMapping)) {
        if (effective === LegacyMapping[key]) {
            return { route: 'registry-alias-target', effective: key };
        }
    }

    return { route: 'UNKNOWN', effective };
}

// bot.action patterns from source (simplified)
const BOT_ACTION_PATTERNS = [
    /^a_/,
    /^help_sec_/,
    /^cat_pg_/,
    /^cat_hub$/,
    /^cat_list_/,
    /^cat_f_/,
    /^fs_/,
    /^p_\d+$/,
    /^pp_/,
    /^check_/,
    /^payment_methods_/,
    /^resend_/,
    /^rate_/,
    /^saas_/,
    /^onb_/,
    /^suporte_/,
    /^ver_afiliado$/,
    /^home_user$/,
    /^add_\d+$/,
    /^buy_\d+$/,
];

function mightHaveBotAction(effective) {
    if (shouldDelegateToLegacyBotAction(effective)) return true;
    if (BOT_ACTION_PATTERNS.some((re) => re.test(effective))) return true;
    // Amostras de template com placeholders numéricos
    if (/^(add|buy|p)_\d+$/.test(effective)) return true;
    if (    /^prod_(edit|del|flash)_\d+$/.test(effective)) return true;
    if (/^prod_(publish|edit_desc)$/.test(effective)) return true;
    return false;
}

registry.clear();
for (const [p, h] of Object.entries(AllHandlers)) {
    registry.register(p, h);
}

const allCallbacks = new Set();
for (const file of walk(SRC)) {
    const content = fs.readFileSync(file, 'utf8');
    for (const cb of extractCallbacks(content)) allCallbacks.add(cb);
}

const unknown = [];
for (const cb of [...allCallbacks].sort()) {
    const r = resolveHandlerKey(cb);
    if (r.route === 'UNKNOWN' && !mightHaveBotAction(r.effective)) {
        unknown.push({ cb, effective: r.effective });
    }
}

console.log(`Callbacks únicos (amostras estáticas): ${allCallbacks.size}`);
if (unknown.length) {
    console.log('\n⚠️  Possíveis órfãos (sem registry nem legacy conhecido):\n');
    for (const u of unknown) {
        console.log(`  - ${u.cb}${u.effective !== u.cb ? ` → ${u.effective}` : ''}`);
    }
    process.exit(1);
}
console.log('\n✅ Nenhum órfão estático detectado.');
process.exit(0);
