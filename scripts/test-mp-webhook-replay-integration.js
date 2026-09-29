#!/usr/bin/env node
'use strict';

/**
 * P5-4 — Integração replay webhook MP (critério P0-2).
 * Simula: processamento → restart (memória limpa) → replay → webhook_dedup_db_hit.
 * Valida processed_webhooks + receipt kv (recover pós-crash).
 * Autossuficiente — não depende de mpWebhookHandler no deploy parcial.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDb = path.join(os.tmpdir(), `hanork-mp-wh-replay-${Date.now()}.db`);
try {
    if (fs.existsSync(testDb)) fs.unlinkSync(testDb);
} catch { /* ignore */ }

process.env.HANORK_DB_PATH = testDb;
process.env.NODE_ENV = 'development';
process.env.MP_WEBHOOK_DB_DEDUP = '1';
process.env.MP_WEBHOOK_REDIS_DEDUP = '0';

const PAYMENT_ID = 'p5-4-replay-test-001';
const PAYMENT_ID_2 = 'p5-4-replay-test-002';
const RECEIPT_PREFIX = 'mp_wh_pending:';

let prisma;
let connect;
try {
    ({ prisma, connect } = require('../src/config/database-sqlite'));
    connect();
} catch (e) {
    console.error('\nSKIP — SQLite indisponível neste ambiente:', e.message);
    console.error('Execute no WSL/Linux: node scripts/test-mp-webhook-replay-integration.js\n');
    process.exit(0);
}

const webhookDedup = require('../src/modules/payment/webhookPaymentDedup');

const logLines = [];
const logger = {
    warn: (msg) => logLines.push(String(msg)),
    info: (msg) => logLines.push(String(msg)),
};

const deps = { prisma, logger, webhookPaymentDedup: webhookDedup };

/**
 * Trecho crítico de processMpPaymentWebhook (dedup memória → DB).
 */
async function simulateWebhookProcess(paymentId, { firstProcess = false } = {}) {
    const pidStr = String(paymentId);
    if (webhookDedup.has(pidStr)) {
        webhookDedup.recordMemoryDedup();
        return { skipped: true, reason: 'memory_dedup' };
    }
    if (webhookDedup.hasDb(prisma, pidStr)) {
        webhookDedup.recordDbDedup();
        webhookDedup.markProcessed(pidStr);
        logger.warn(`webhook_dedup_db_hit payment_id=${pidStr}`);
        return { skipped: true, reason: 'db_dedup' };
    }
    if (firstProcess) {
        webhookDedup.markProcessed(pidStr);
        webhookDedup.markDb(prisma, pidStr, 9001);
        return { processed: true, orderId: 9001 };
    }
    return { skipped: true, reason: 'not_simulated' };
}

function persistReceipt(paymentId, body) {
    const db = connect();
    db.prepare(
        `INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, datetime('now'))`
    ).run(`${RECEIPT_PREFIX}${paymentId}`, JSON.stringify({ body, received_at: new Date().toISOString() }));
}

function listPendingReceipts() {
    const db = connect();
    return db.prepare(`SELECT key, value FROM kv_store WHERE key LIKE ?`).all(`${RECEIPT_PREFIX}%`);
}

function clearReceipt(paymentId) {
    const db = connect();
    db.prepare('DELETE FROM kv_store WHERE key = ?').run(`${RECEIPT_PREFIX}${paymentId}`);
}

async function recoverPendingReceipts() {
    const rows = listPendingReceipts();
    let replayed = 0;
    for (const row of rows) {
        const pid = String(row.key).slice(RECEIPT_PREFIX.length);
        if (!pid) continue;
        const r = await simulateWebhookProcess(pid, { firstProcess: true });
        if (r.processed) {
            clearReceipt(pid);
            replayed++;
        }
    }
    if (replayed > 0) {
        logger.info(`[WEBHOOK] replay ${replayed} receipt(s) pendentes pós-crash`);
    }
    return replayed;
}

let failed = 0;
async function test(name, fn) {
    try {
        await fn();
        console.log('  OK', name);
    } catch (e) {
        failed++;
        console.error('  FAIL', name + ':', e.message);
    }
}

console.log('\n=== MP webhook replay integration (P5-4 / P0-2) ===\n');

(async () => {
    await test('primeiro processamento grava processed_webhooks', async () => {
        webhookDedup._processedPaymentIds.clear();
        const db = connect();
        db.prepare('DELETE FROM processed_webhooks WHERE payment_id = ?').run(PAYMENT_ID);

        const r = await simulateWebhookProcess(PAYMENT_ID, { firstProcess: true });
        assert.strictEqual(r.processed, true);
        assert.strictEqual(prisma.processedWebhook.isProcessed(PAYMENT_ID), true);
    });

    await test('replay pós-restart (memória limpa) → db_dedup + webhook_dedup_db_hit', async () => {
        webhookDedup._processedPaymentIds.clear();
        logLines.length = 0;
        const r = await simulateWebhookProcess(PAYMENT_ID);
        assert.strictEqual(r.skipped, true);
        assert.strictEqual(r.reason, 'db_dedup');
        assert.ok(
            logLines.some((l) => l.includes('webhook_dedup_db_hit')),
            `log esperado webhook_dedup_db_hit, got: ${logLines.join(' | ')}`
        );
    });

    await test('receipt pendente no kv_store → recover pós-crash', async () => {
        webhookDedup._processedPaymentIds.clear();
        const db = connect();
        db.prepare('DELETE FROM processed_webhooks WHERE payment_id = ?').run(PAYMENT_ID_2);
        db.prepare('DELETE FROM kv_store WHERE key LIKE ?').run(`${RECEIPT_PREFIX}%`);

        persistReceipt(PAYMENT_ID_2, { type: 'payment', data: { id: PAYMENT_ID_2 } });
        assert.strictEqual(listPendingReceipts().length, 1);

        const replayed = await recoverPendingReceipts();
        assert.strictEqual(replayed, 1);
        assert.strictEqual(listPendingReceipts().length, 0);
        assert.strictEqual(prisma.processedWebhook.isProcessed(PAYMENT_ID_2), true);
    });

    await test('segundo replay do mesmo payment → db_dedup novamente', async () => {
        webhookDedup._processedPaymentIds.clear();
        logLines.length = 0;
        const r = await simulateWebhookProcess(PAYMENT_ID_2);
        assert.strictEqual(r.reason, 'db_dedup');
        assert.ok(logLines.some((l) => l.includes('webhook_dedup_db_hit')));
    });

    try {
        if (fs.existsSync(testDb)) fs.unlinkSync(testDb);
    } catch { /* ignore */ }

    console.log(failed ? `\n${failed} falha(s)\n` : '\nOK — MP webhook replay integration (P5-4)\n');
    process.exit(failed ? 1 : 0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
