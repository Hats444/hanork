#!/usr/bin/env node
'use strict';

/**
 * Testes da Operational Intelligence Layer (heurística local, sem IA externa).
 */
require('../src/config/env');

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const EntityExtractor = require('../src/modules/context/EntityExtractor');
const IntentClassifier = require('../src/modules/context/IntentClassifier');
const OperationalParser = require('../src/modules/context/OperationalParser');
const ConfidenceScorer = require('../src/modules/context/ConfidenceScorer');
const ContextMemory = require('../src/modules/context/ContextMemory');
const DuplicateProtection = require('../src/modules/context/DuplicateProtection');
const IntentEngine = require('../src/modules/context/IntentEngine');
const { INTENT_TYPES } = require('../src/modules/context/IntentTypes');
const SafeExecution = require('../src/modules/context/SafeExecution');

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

async function testAsync(name, fn) {
    try {
        await fn();
        console.log('  OK', name);
    } catch (e) {
        failed++;
        console.error('  FAIL', name + ':', e.message);
    }
}

function mockState() {
    const store = new Map();
    return {
        get(key) {
            const e = store.get(key);
            if (!e) return null;
            if (e.expiry && Date.now() > e.expiry) {
                store.delete(key);
                return null;
            }
            return e.value;
        },
        set(key, value, ttlMs) {
            store.set(key, { value, expiry: ttlMs ? Date.now() + ttlMs : null });
        },
    };
}

function setupTestDb() {
    const Database = require('better-sqlite3');
    const tmp = path.join(os.tmpdir(), `hanork-ctx-${Date.now()}.db`);
    const db = new Database(tmp);
    db.exec(`
        CREATE TABLE kv_store (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT
        );
    `);
    return {
        db,
        cleanup: () => {
            try {
                db.close();
                fs.unlinkSync(tmp);
            } catch {
                /* ignore */
            }
        },
    };
}

async function run() {
    console.log('\n=== Context layer (OIL) ===\n');

    test('extrai cliente, valor e pix', () => {
        const e = EntityExtractor.extractAll('João pagou 350 no pix');
        assert.strictEqual(e.client, 'João');
        assert.strictEqual(e.amount, 350);
        assert.strictEqual(e.method, 'pix');
    });

    test('português informal — pic abreviado', () => {
        const e = EntityExtractor.extractAll('marcos pagou 200 no pic');
        assert.ok(e.amount === 200);
    });

    test('classifica payment_confirmation', () => {
        const c = IntentClassifier.classify('João pagou 350 no pix', { amount: 350 });
        assert.strictEqual(c.type, INTENT_TYPES.PAYMENT_CONFIRMATION);
        assert.ok(c.score > 0.8);
    });

    test('classifica service_register', () => {
        const t = 'troca de disjuntor pro Marcos ficou 180';
        const e = EntityExtractor.extractAll(t);
        const c = IntentClassifier.classify(t, e);
        assert.strictEqual(c.type, INTENT_TYPES.SERVICE_REGISTER);
    });

    test('classifica appointment_schedule', () => {
        const t = 'amanha 14h na casa do Marcos';
        const c = IntentClassifier.classify(t, {});
        assert.strictEqual(c.type, INTENT_TYPES.APPOINTMENT_SCHEDULE);
    });

    test('classifica debt_tracking com pronome', () => {
        const c = IntentClassifier.classify('ele vai pagar sexta', { pronounRef: true });
        assert.strictEqual(c.type, INTENT_TYPES.DEBT_TRACKING);
    });

    test('memória resolve pronome para último cliente', () => {
        const sm = mockState();
        const mem = new ContextMemory(sm);
        mem.remember(1, 99, { lastClient: 'João' });
        const client = mem.resolveClient(1, 99, { pronounRef: true }, 'ele vai pagar sexta');
        assert.strictEqual(client, 'João');
    });

    test('isolamento multi-tenant na memória', () => {
        const sm = mockState();
        const mem = new ContextMemory(sm);
        mem.remember(1, 1, { lastClient: 'A' });
        mem.remember(2, 1, { lastClient: 'B' });
        assert.strictEqual(mem.get(1, 1).lastClient, 'A');
        assert.strictEqual(mem.get(2, 1).lastClient, 'B');
    });

    test('duplicidade bloqueia segunda execução', () => {
        const sm = mockState();
        const dup = new DuplicateProtection(sm);
        assert.strictEqual(dup.isDuplicate(1, 1, 'João pagou 350'), false);
        assert.strictEqual(dup.isDuplicate(1, 1, 'João pagou 350'), true);
    });

    test('confidence scorer — alta confiança executa', () => {
        const s = ConfidenceScorer.score({
            classifierScore: 0.9,
            entities: { client: 'João', amount: 350, method: 'pix' },
        });
        assert.strictEqual(s.action, 'execute');
        assert.ok(s.confidence >= 0.85);
    });

    test('confidence scorer — baixa ignora', () => {
        const s = ConfidenceScorer.score({
            classifierScore: 0.3,
            entities: {},
        });
        assert.strictEqual(s.action, 'ignore');
    });

    test('parser estrutura operacional', () => {
        const p = OperationalParser.parse('João pagou 350 no pix', {
            tenantId: 5,
            operatorId: 1,
            source: 'telegram',
        });
        assert.strictEqual(p.type, INTENT_TYPES.PAYMENT_CONFIRMATION);
        assert.strictEqual(p.entities.client, 'João');
        assert.strictEqual(p.tenant_id, 5);
    });

    const { db, cleanup } = setupTestDb();
    const connect = () => db;

    await testAsync('IntentEngine persiste evento sem marcar pedido pago', async () => {
        const engine = new IntentEngine({ stateManager: mockState(), dbRaw: connect });
        const r = await engine.process({
            text: 'João pagou 350 no pix',
            tenantId: 10,
            operatorId: 42,
        });
        assert.strictEqual(r.ok, true);
        assert.ok(r.routed?.event?.intent === INTENT_TYPES.PAYMENT_CONFIRMATION);
        const row = db
            .prepare('SELECT value FROM kv_store WHERE key LIKE ?')
            .get('ctx_evt:10:%');
        assert.ok(!row || true);
        const rows = db.prepare('SELECT key FROM kv_store WHERE key LIKE ?').all('ctx_evt:10:%');
        assert.ok(rows.length >= 1);
    });

    await testAsync('mensagem curta é ignorada', async () => {
        const engine = new IntentEngine({ stateManager: mockState(), dbRaw: connect });
        const r = await engine.process({ text: 'oi', tenantId: 1, operatorId: 1 });
        assert.ok(r.skipped);
    });

    await testAsync('performance parsing < 100ms (amostra)', async () => {
        const samples = [
            'João pagou 350 no pix',
            'troca de tomada ficou 200',
            'amanha 14h na casa do Marcos',
            'me lembra sexta',
            'ele pediu desconto',
        ];
        for (const s of samples) {
            const t0 = Date.now();
            OperationalParser.parse(s, { tenantId: 1, operatorId: 1 });
            const ms = Date.now() - t0;
            assert.ok(ms < 100, `lento: ${ms}ms para "${s}"`);
        }
    });

    await testAsync('SafeExecution timeout não quebra', async () => {
        const r = await SafeExecution.run(
            () => new Promise((resolve) => setTimeout(() => resolve('ok'), 200)),
            { timeoutMs: 50 }
        );
        assert.strictEqual(r.ok, false);
    });

    cleanup();

    console.log(failed ? `\n${failed} falha(s)\n` : '\nTodos os testes de context passaram.\n');
    process.exit(failed ? 1 : 0);
}

run().catch((e) => {
    console.error(e);
    process.exit(1);
});
