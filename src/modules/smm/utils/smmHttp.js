'use strict';

const https = require('https');
const axios = require('axios');

/** Conexões curtas — evita TLS stale no fornecedor (socket disconnected before secure TLS). */
const SMM_HTTPS_AGENT = new https.Agent({ keepAlive: false, family: 4, maxSockets: 4 });

const WARN_COOLDOWN_MS = 2 * 60 * 1000;
const warnAtByAction = new Map();

function isTransientNetworkError(err) {
    const msg = String(err?.message || err?.cause?.message || '');
    const code = String(err?.code || '');
    return (
        /eai_again|enotfound|etimedout|econnrefused|enetunreach|econnreset|eproto|epipe|socket hang up|getaddrinfo|secure tls|ssl_error|socket disconnected|network socket|err_ssl|certificate/i.test(
            msg
        ) || /^(ECONNRESET|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EPROTO|EPIPE)$/i.test(code)
    );
}

function shouldLogApiWarn(action) {
    const key = String(action || 'unknown');
    const now = Date.now();
    const prev = warnAtByAction.get(key) || 0;
    if (now - prev < WARN_COOLDOWN_MS) return false;
    warnAtByAction.set(key, now);
    return true;
}

async function postForm(url, payload, { timeoutMs, logger, logTag, maxAttempts = 3 } = {}) {
    let attempt = 0;
    while (attempt < maxAttempts) {
        try {
            const response = await axios.post(url, new URLSearchParams(payload), {
                timeout: timeoutMs,
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                httpsAgent: SMM_HTTPS_AGENT,
            });
            return response.data;
        } catch (err) {
            const isLast = attempt >= maxAttempts - 1;
            if (!isLast && isTransientNetworkError(err)) {
                await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
                attempt++;
                continue;
            }
            const raw = err.response?.data;
            const msg =
                typeof raw === 'object' && raw?.message
                    ? raw.message
                    : typeof raw === 'string'
                      ? raw
                      : err.message || err.code || 'network_error';
            if (logger && logTag && shouldLogApiWarn(payload.action)) {
                const level = isTransientNetworkError(err) ? 'debug' : 'warn';
                logger[level](logTag, {
                    action: payload.action,
                    detail: String(msg).slice(0, 200),
                    transient: isTransientNetworkError(err),
                });
            }
            return { error: true, message: msg };
        }
    }
    return { error: true, message: 'network_error' };
}

module.exports = {
    SMM_HTTPS_AGENT,
    isTransientNetworkError,
    shouldLogApiWarn,
    postForm,
};
