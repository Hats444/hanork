'use strict';

function isSqliteBusy(err) {
    return (
        err?.code === 'SQLITE_BUSY' ||
        /database is locked/i.test(String(err?.message || ''))
    );
}

function sleepSync(ms) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
        /* sync wait */
    }
}

function withSqliteRetry(fn, attempts = 15) {
    for (let i = 0; i < attempts; i++) {
        try {
            return fn();
        } catch (e) {
            if (!isSqliteBusy(e) || i === attempts - 1) throw e;
            sleepSync(Math.min(600, 50 * (i + 1) * (i + 1)));
        }
    }
    return undefined;
}

module.exports = { isSqliteBusy, withSqliteRetry };
