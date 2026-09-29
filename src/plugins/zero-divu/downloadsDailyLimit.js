'use strict';

const { connect } = require('../config/database-sqlite');

const KV_PREFIX = 'dl_daily:';
const DEFAULT_DAILY_LIMIT = 100;

function getDailyLimit() {
    const n = parseInt(process.env.DOWNLOADS_DAILY_LIMIT || '', 10);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_DAILY_LIMIT;
}

function dayKeyBrazil() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

function kvKey(telegramId) {
    return `${KV_PREFIX}${String(telegramId)}:${dayKeyBrazil()}`;
}

function readCount(telegramId, db = null) {
    if (!telegramId) return 0;
    try {
        const d = db || connect();
        const row = d.prepare('SELECT value FROM kv_store WHERE key=?').get(kvKey(telegramId));
        const n = parseInt(row?.value, 10);
        return Number.isFinite(n) && n > 0 ? n : 0;
    } catch {
        return 0;
    }
}

function getStatus(telegramId, db = null) {
    const limit = getDailyLimit();
    const used = readCount(telegramId, db);
    return {
        limit,
        used,
        remaining: Math.max(0, limit - used),
        day: dayKeyBrazil(),
    };
}

/**
 * Reserva 1 slot de download (atômico). Retorna false se limite atingido.
 */
function tryConsume(telegramId, amount = 1, db = null) {
    const limit = getDailyLimit();
    const inc = Math.max(1, parseInt(amount, 10) || 1);
    if (!telegramId) return { ok: false, reason: 'no_user', ...getStatus(telegramId, db) };
    try {
        const d = db || connect();
        const key = kvKey(telegramId);
        const row = d.prepare('SELECT value FROM kv_store WHERE key=?').get(key);
        const current = parseInt(row?.value, 10) || 0;
        if (current + inc > limit) {
            return { ok: false, reason: 'limit', ...getStatus(telegramId, d), used: current };
        }
        const next = current + inc;
        d.prepare(
            `INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, datetime('now'))`
        ).run(key, String(next));
        return {
            ok: true,
            limit,
            used: next,
            remaining: Math.max(0, limit - next),
            day: dayKeyBrazil(),
        };
    } catch (e) {
        return { ok: false, reason: 'error', error: e.message, ...getStatus(telegramId, db) };
    }
}

module.exports = {
    DEFAULT_DAILY_LIMIT,
    getDailyLimit,
    getStatus,
    tryConsume,
    dayKeyBrazil,
};
