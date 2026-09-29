'use strict';

const { sleep } = require('../utils/sleep');

const RETRY_WAIT_MS = 4000;
const DEFAULT_MAX_WAIT_MS = 120000;

async function waitForSocket(maxWaitMs = DEFAULT_MAX_WAIT_MS) {
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
        if (require('./gracefulShutdownManager').isShuttingDown()) return null;
        const sock = require('./socketRegistry').get();
        if (sock?.user) return sock;
        try {
            const bridge = require('./connectRetryBridge');
            if (typeof bridge.requestRetry === 'function') {
                bridge.requestRetry(RETRY_WAIT_MS);
            }
        } catch {
            /* ignore */
        }
        try {
            const ops = require('../ipc/operations');
            if (typeof ops.reconnectSession === 'function') {
                await ops.reconnectSession().catch(() => null);
            }
        } catch {
            /* ignore */
        }
        await sleep(RETRY_WAIT_MS);
    }
    return require('./socketRegistry').get()?.user
        ? require('./socketRegistry').get()
        : null;
}

function isTransientBlastError(err) {
    const msg = String(err?.message || err?.code || err || '');
    return /conexão|connection|socket|timeout|econn|estabilizando|not_connected|relay|closed|reset|unavailable|disconnect/i.test(
        msg
    );
}

async function withBlastRetry(fn, { maxAttempts = 5, label = 'blast' } = {}) {
    let lastErr;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            let sock = require('./socketRegistry').get();
            if (!sock?.user) {
                sock = await waitForSocket(attempt === 0 ? 15000 : DEFAULT_MAX_WAIT_MS);
            }
            if (!sock?.user) throw new Error('conexão instável');
            return await fn(sock);
        } catch (e) {
            lastErr = e;
            if (!isTransientBlastError(e) || attempt >= maxAttempts - 1) throw e;
            await sleep(RETRY_WAIT_MS * (attempt + 1));
        }
    }
    throw lastErr;
}

module.exports = {
    waitForSocket,
    withBlastRetry,
    isTransientBlastError,
    RETRY_WAIT_MS,
};
