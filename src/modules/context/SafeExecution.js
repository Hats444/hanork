'use strict';

const ContextLogger = require('./ContextLogger');

const DEFAULT_TIMEOUT_MS = parseInt(process.env.CONTEXT_PARSE_TIMEOUT_MS || '100', 10);

function withTimeout(promise, ms = DEFAULT_TIMEOUT_MS) {
    return Promise.race([
        promise,
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error('CONTEXT_TIMEOUT')), ms)
        ),
    ]);
}

async function run(fn, meta = {}) {
    const start = Date.now();
    try {
        const result = await withTimeout(Promise.resolve().then(fn), meta.timeoutMs);
        ContextLogger.parseTiming({ ms: Date.now() - start, ...meta });
        return { ok: true, result };
    } catch (e) {
        ContextLogger.parseError(e, { ms: Date.now() - start, ...meta });
        return { ok: false, error: e.message };
    }
}

module.exports = { run, withTimeout, DEFAULT_TIMEOUT_MS };
