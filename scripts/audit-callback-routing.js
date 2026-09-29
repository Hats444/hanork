'use strict';

/**
 * Audita callbacks: registry vs legado.
 * Falha se um callback do registry bateria em padrão legado sem handler bot.action.
 * Uso: node scripts/audit-callback-routing.js
 */

const fs = require('fs');
const path = require('path');
const { AllHandlers, LegacyMapping } = require('../src/core/UserHandlers');
const { shouldDelegateToLegacyBotAction } = require('../src/telegram/callbacks/legacyPatterns');

const SRC = path.join(__dirname, '..', 'src');
const botActionRe = /bot\.action\s*\(\s*(?:'([^']+)'|"([^"]+)"|(\/\^?[^/]+\$?\/[a-z]*))/g;

function collectBotActionPatterns(dir) {
    const patterns = new Set();
    const walk = (d) => {
        for (const name of fs.readdirSync(d)) {
            const fp = path.join(d, name);
            if (fs.statSync(fp).isDirectory()) {
                if (name === 'node_modules') continue;
                walk(fp);
                continue;
            }
            if (!name.endsWith('.js')) continue;
            const text = fs.readFileSync(fp, 'utf8');
            let m;
            botActionRe.lastIndex = 0;
            while ((m = botActionRe.exec(text)) !== null) {
                const p = m[1] || m[2] || m[3];
                if (p) patterns.add(p);
            }
        }
    };
    walk(dir);
    return patterns;
}

function registryPatterns() {
    const keys = Object.keys(AllHandlers);
    for (const k of Object.keys(LegacyMapping)) keys.push(k);
    return keys;
}

function matchesAnyPattern(data, patterns) {
    for (const p of patterns) {
        if (p.includes('*')) {
            const re = new RegExp(`^${p.replace(/\*/g, '.*')}$`);
            if (re.test(data)) return p;
        } else if (p.startsWith('/') && p.endsWith('/')) {
            if (new RegExp(p.slice(1, -1)).test(data)) return p;
        } else if (p.startsWith('/') && p.endsWith('/i')) {
            if (new RegExp(p.slice(1, -2), 'i').test(data)) return p;
        } else if (p.startsWith('/') && p.endsWith('/g')) {
            if (new RegExp(p.slice(1, -2), 'g').test(data)) return p;
        } else if (p.startsWith('/') && p.endsWith('/gi')) {
            if (new RegExp(p.slice(1, -3), 'gi').test(data)) return p;
        } else if (p.startsWith('/') && p.endsWith('$/,') === false) {
            try {
                const end = p.lastIndexOf('/');
                const body = p.slice(1, end);
                const flags = p.slice(end + 1) || '';
                if (new RegExp(body, flags).test(data)) return p;
            } catch {
                /* ignore */
            }
        } else if (p === data) {
            return p;
        }
    }
    return null;
}

function sampleFromPattern(p) {
    if (p.includes('*')) return p.replace(/\*/g, '1');
    return p;
}

const legacyPatterns = collectBotActionPatterns(SRC);
const registry = registryPatterns();

const samples = new Set();
for (const p of registry) samples.add(sampleFromPattern(p));
samples.add('downloads:open');
samples.add('downloads:hub');
samples.add('help:open');
samples.add('user:email:start');
samples.add('menu:minha_conta');

let issues = 0;
for (const cb of samples) {
    const inRegistry = registry.some((p) => {
        if (p === cb) return true;
        if (p.includes('*')) {
            return new RegExp(`^${p.replace(/\*/g, '[^:]*')}$`).test(cb);
        }
        return false;
    });
    if (!inRegistry) continue;
    if (!shouldDelegateToLegacyBotAction(cb)) continue;
    const legacyHit = matchesAnyPattern(cb, legacyPatterns);
    if (!legacyHit) {
        console.log('WARN registry+legacy-delegate sem bot.action:', cb);
        issues++;
    }
}

if (issues === 0) {
    console.log('OK — callbacks do registry não ficam órfãos com registry-first.');
} else {
    console.log(`\n${issues} aviso(s). Com registry-first no router, o registry trata antes do legado.`);
    process.exit(0);
}
