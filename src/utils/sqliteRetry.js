'use strict';

/**
 * Retry curto para SQLITE_BUSY — bot Hanork + worker Zero Divu no mesmo hanork.db.
 */

function isSqliteBusy(err) {
    return (
        err?.code === 'SQLITE_BUSY' ||
        /database is locked/i.test(String(err?.message || ''))
    );
}

function sleepSync(ms) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
        /* sync wait — better-sqlite3 */
    }
}

let _busyTotal = 0;
let _busyLogAt = 0;

function logSqliteBusy(attempt) {
    try {
        const now = Date.now();
        if (now - _busyLogAt < 5000) return;
        _busyLogAt = now;
        require('../config/logger').warn('[SQLITE] BUSY — retry', { attempt, busyTotal: _busyTotal });
    } catch {
        /* logger indisponível em boot muito cedo */
    }
}

function withSqliteRetry(fn, attempts = 15) {
    for (let i = 0; i < attempts; i++) {
        try {
            return fn();
        } catch (e) {
            if (!isSqliteBusy(e) || i === attempts - 1) throw e;
            _busyTotal += 1;
            logSqliteBusy(i + 1);
            sleepSync(Math.min(600, 50 * (i + 1) * (i + 1)));
        }
    }
    return undefined;
}

function getSqliteBusyStats() {
    return { busyTotal: _busyTotal };
}

async function withSqliteRetryAsync(fn, attempts = 15) {
    for (let i = 0; i < attempts; i++) {
        try {
            return await fn();
        } catch (e) {
            if (!isSqliteBusy(e) || i === attempts - 1) throw e;
            _busyTotal += 1;
            logSqliteBusy(i + 1);
            await new Promise((r) => setTimeout(r, Math.min(600, 50 * (i + 1) * (i + 1))));
        }
    }
    return undefined;
}

module.exports = {
    isSqliteBusy,
    withSqliteRetry,
    withSqliteRetryAsync,
    getSqliteBusyStats,
};
