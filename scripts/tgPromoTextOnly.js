'use strict';

const KEY_PREFIX = 'tg_promo_text_only:';

function key(chatId) {
    return `${KEY_PREFIX}${String(chatId)}`;
}

function getDb() {
    try {
        return require('../config/database-sqlite').connect();
    } catch {
        return null;
    }
}

function isTextOnly(chatId) {
    const db = getDb();
    if (!db || chatId == null) return false;
    try {
        return !!db.prepare('SELECT 1 FROM kv_store WHERE key=?').get(key(chatId));
    } catch {
        return false;
    }
}

function markTextOnly(chatId, reason = '') {
    const db = getDb();
    if (!db || chatId == null) return;
    try {
        db.prepare(
            `INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, datetime('now'))`
        ).run(
            key(chatId),
            JSON.stringify({ at: Date.now(), reason: String(reason).slice(0, 120) })
        );
        const OpsMetricsStore = require('./ops/OpsMetricsStore');
        OpsMetricsStore.record(db, {
            channel: 'tg',
            kind: 'countermeasure',
            target: String(chatId),
            detail: String(reason || 'foto bloqueada').slice(0, 240),
            countermeasure: 'próximos envios só texto neste chat',
        });
    } catch {
        /* ignore */
    }
}

function clearTextOnly(chatId) {
    const db = getDb();
    if (!db || chatId == null) return;
    try {
        db.prepare('DELETE FROM kv_store WHERE key=?').run(key(chatId));
    } catch {
        /* ignore */
    }
}

module.exports = { isTextOnly, markTextOnly, clearTextOnly, KEY_PREFIX };
