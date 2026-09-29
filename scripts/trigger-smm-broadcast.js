#!/usr/bin/env node
'use strict';

/**
 * Dispara divulgação SMM imediata (PV + grupos + canais + ponte + WA).
 * Requer bot parado OU use via admin — preferir injetar na fila do bot rodando.
 *
 * Uso (WSL, com bot rodando — sinal via Redis/kv):
 *   node scripts/trigger-smm-broadcast.js
 */

const path = require('path');
process.chdir(path.join(__dirname, '..'));
require('../src/config/env');

const { connect } = require('../src/config/database-sqlite');
const { SMM_QUEUE_MARKER } = require('../src/data/smmBroadcastVariants');

connect();
const db = connect();

const KEY = 'auto_broadcast:product_queue';
const FLAG = 'auto_broadcast:run_smm_now';

let queue = [];
try {
    const raw = db.prepare('SELECT value FROM kv_store WHERE key=?').get(KEY)?.value;
    queue = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(queue)) queue = [];
} catch {
    queue = [];
}

queue.unshift(SMM_QUEUE_MARKER);
db.prepare(
    `INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, datetime('now'))`
).run(KEY, JSON.stringify(queue));

db.prepare(
    `INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, datetime('now'))`
).run(FLAG, String(Date.now()));

db.prepare(
    `INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, datetime('now'))`
).run('auto_broadcast:last_sent', '0');

console.log('[trigger-smm-broadcast] Slot SMM inserido na fila AutoBroadcast.');
console.log('Próximo ciclo (~5 min check) ou reinicie com AUTO_BROADCAST_BOOT_GRACE_MS=0 para forçar.');
console.log('Admin: painel divulgação → executar agora também funciona.');
