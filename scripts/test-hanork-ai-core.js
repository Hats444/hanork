#!/usr/bin/env node
'use strict';

/**
 * B4 — Hanork AI Core: prompt registry, tool registry, provider hub.
 */
require('../src/config/env');

const assert = require('assert');
const hanorkAiCore = require('../src/core/hanorkAiCore');

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

console.log('\n=== Hanork AI Core (B4) ===\n');

test('isAiCoreEnabled default', () => {
    assert.strictEqual(hanorkAiCore.isAiCoreEnabled(), true);
});

test('promptRegistry — planner.system render', () => {
    const p = hanorkAiCore.getPrompt('planner.system', {
        isAdmin: true,
        inPrivate: true,
        message: 'teste',
        contextBlock: '',
        toolsList: 'open_catalog',
        actionsList: 'cart',
        rulesBlock: '- regra',
    });
    assert.ok(p.includes('teste'));
    assert.ok(p.includes('open_catalog'));
});

test('promptRegistry — meta hash', () => {
    const m = hanorkAiCore.getRegistryMeta();
    assert.strictEqual(m.version, 'v1');
    assert.ok(m.ids.includes('planner.system'));
});

test('toolRegistry — resolve open_catalog', () => {
    const r = hanorkAiCore.resolveTool('open_catalog', {}, { isAdmin: false });
    assert.strictEqual(r.action, 'show_products');
});

test('toolRegistry — admin gate', () => {
    assert.strictEqual(hanorkAiCore.resolveTool('open_admin', {}, { isAdmin: false }), null);
    assert.ok(hanorkAiCore.resolveTool('open_admin', {}, { isAdmin: true }));
});

test('buildPlannerPrompt — inclui ferramentas', () => {
    const p = hanorkAiCore.buildPlannerPrompt('quero ver produtos', { isAdmin: false, contextBlock: '' });
    assert.ok(p.includes('open_catalog'));
});

test('providerHub — health score range', () => {
    const score = hanorkAiCore.computeHealthScore({ success: 10, fail: 2, avgMs: 2000 });
    assert.ok(score > 0 && score <= 1.5);
});

test('providerHub — getHealthReport', () => {
    const r = hanorkAiCore.getHealthReport();
    assert.ok(Array.isArray(r.providers));
});

test('validatePlannerOutput — tool field', () => {
    const HanorkLlmPlanner = require('../src/services/hanork-ai/HanorkLlmPlanner');
    const out = HanorkLlmPlanner.validatePlannerOutput(
        { tool: 'open_catalog', confidence: 90, params: {} },
        'catálogo',
        { isAdmin: false, routerContext: {} }
    );
    assert.strictEqual(out.action, 'show_products');
});

console.log(failed ? `\n${failed} falha(s)\n` : '\nOK — Hanork AI Core\n');
process.exit(failed ? 1 : 0);
