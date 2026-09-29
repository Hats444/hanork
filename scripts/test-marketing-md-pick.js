#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');

process.env.BROADCAST_MARKETING_MD = '1';

const {
    listMdFiles,
    parseMarketingMd,
    pickHanorkFromMarkdown,
    pickSmmFromMarkdown,
    KV_HANORK,
    KV_SMM,
} = require('../src/data/marketingMarkdownVariants');
const { pickHanorkBroadcast, formatHanorkTelegramHtml } = require('../src/data/hanorkBroadcastVariants');
const { pickSmmBroadcast, formatSmmTelegramHtml } = require('../src/data/smmBroadcastVariants');

function mockKv() {
    const m = new Map();
    return {
        get(k) {
            return m.get(k) ?? null;
        },
        set(k, v) {
            m.set(k, v);
        },
    };
}

assert.strictEqual(listMdFiles('hanork').length, 100, 'hanork md count');
assert.strictEqual(listMdFiles('smm').length, 100, 'smm md count');

const sample = parseMarketingMd(
    '# Hanork — Texto 001\n\n**Estilo:** confiança\n\n<b>Headline</b>\n\nCorpo.\n\n---\n',
    'md-001'
);
assert.strictEqual(sample.headline, 'Headline');
assert(sample.fromMarkdown);
assert(sample.fullBody.includes('<b>Headline</b>'));

const photosDir = path.join(__dirname, '..', 'fotos');
const kv = mockKv();

const h1 = pickHanorkFromMarkdown(kv, photosDir);
assert(h1?.variant?.fromMarkdown, 'hanork md pick');
assert(/^hanork_\d+\.jpg$/i.test(h1.photoFile), 'hanork photo paired');
assert(kv.get(KV_HANORK), 'hanork queue persisted');

const h2 = pickHanorkFromMarkdown(kv, photosDir);
assert(h2.variant.id !== h1.variant.id, 'hanork rotation');

const s1 = pickSmmFromMarkdown(kv, photosDir);
assert(s1?.variant?.fromMarkdown, 'smm md pick');
assert(
    /^(ssm|smm)_/i.test(s1.photoFile) || s1.photoFile === 'smm_divulgacao.jpg',
    'smm photo paired'
);
assert(kv.get(KV_SMM), 'smm queue persisted');

const hb = pickHanorkBroadcast(kv, photosDir);
const tg = formatHanorkTelegramHtml(hb.variant, { name: 'Hanork PRO', price: 297.9 });
assert(tg.includes('<b>') || tg.includes('href='), 'hanork telegram html');

const sb = pickSmmBroadcast(kv, photosDir);
const sg = formatSmmTelegramHtml(sb.variant, { username: 'hanork_bot' });
assert(sg.includes('hanork_bot') || sg.includes('t.me/'), 'smm telegram html');

console.log('test-marketing-md-pick.js OK');
console.log('  hanork:', h1.variant.id, '→', h1.photoFile);
console.log('  smm:', s1.variant.id, '→', s1.photoFile);
