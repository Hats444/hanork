#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
    extractIaResponseText,
    parseIaApiBody,
    is429Error,
    looksLikeErrorPayload,
} = require('../src/services/zeroTwoIaResponse');

const FIXTURES = require('./fixtures/ia-api-responses.json');

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

console.log('\n=== Zero Two IA response parser ===\n');

test('gpt/gpt4 sucesso — status + resultado', () => {
    const text = parseIaApiBody(FIXTURES.gptSuccess, 200);
    assert.ok(text.includes('Automatize'), text);
});

test('gpt erro 429 em error (HTTP 200)', () => {
    assert.throws(() => parseIaApiBody(FIXTURES.gptError429, 200), /429/);
    assert.strictEqual(extractIaResponseText(FIXTURES.gptError429), '');
});

test('gpt4 erro 429 em error', () => {
    assert.throws(() => parseIaApiBody(FIXTURES.gpt4Error429, 200), /429/);
    assert.ok(is429Error(null, FIXTURES.gpt4Error429, 200));
});

test('gemini erro quota em detalhes (HTTP 500)', () => {
    assert.throws(() => parseIaApiBody(FIXTURES.geminiErrorQuota, 500), /429/);
    assert.ok(looksLikeErrorPayload(FIXTURES.geminiErrorQuota));
});

test('gemini sucesso — resultado string', () => {
    const text = parseIaApiBody(FIXTURES.geminiSuccess, 200);
    assert.ok(text.includes('Telegram'), text);
});

test('gemini sucesso — candidates nested', () => {
    const text = parseIaApiBody(FIXTURES.geminiSuccessCandidates, 200);
    assert.strictEqual(text, 'Copy persuasiva gemini');
});

test('zerotwo sucesso — resultado', () => {
    const text = parseIaApiBody(FIXTURES.zerotwoSuccess, 200);
    assert.ok(text.includes('vendas'), text);
});

test('não usa campo error como texto', () => {
    assert.strictEqual(extractIaResponseText(FIXTURES.gptError429), '');
});

test('403 HTML string', () => {
    assert.throws(
        () => parseIaApiBody('<html>API Key Inválida</html>', 403),
        /403|inválida/i
    );
});

test('rotação por produto — alterna IA inicial', () => {
    const prev = process.env.ZEROTWO_AI_PROVIDERS;
    process.env.ZEROTWO_AI_PROVIDERS = 'gpt,gpt4,gemini,zerotwo';
    delete require.cache[require.resolve('../src/services/GptProviderPool')];
    const { sortedProviders } = require('../src/services/GptProviderPool');
    const a = sortedProviders({ rotateIndex: 0 }).map((p) => p.id);
    const b = sortedProviders({ rotateIndex: 1 }).map((p) => p.id);
    assert.deepStrictEqual(a, ['gpt', 'gpt4', 'gemini', 'zerotwo']);
    assert.deepStrictEqual(b, ['gpt4', 'gemini', 'zerotwo', 'gpt']);
    if (prev !== undefined) process.env.ZEROTWO_AI_PROVIDERS = prev;
    else delete process.env.ZEROTWO_AI_PROVIDERS;
    delete require.cache[require.resolve('../src/services/GptProviderPool')];
});

console.log(failed ? `\n${failed} falha(s)\n` : '\nOK\n');
process.exit(failed ? 1 : 0);
