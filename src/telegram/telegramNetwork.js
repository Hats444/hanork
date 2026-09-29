'use strict';

/** Erros de rede/DNS/timeout ao falar com api.telegram.org — não devem derrubar o processo. */
function isTelegramNetworkError(err) {
    if (!err) return false;
    const code = err.code || err.errno;
    if (code === 'ECONNRESET' || code === 'ECONNREFUSED' || code === 'ENOTFOUND' ||
        code === 'ETIMEDOUT' || code === 'EAI_AGAIN' || code === 'ENETUNREACH') {
        return true;
    }
    if (err.type === 'system') return true;
    const msg = String(err.message || err.description || err || '');
    if (msg.includes('api.telegram.org') && /failed|timeout|ETIMEDOUT|ENOTFOUND|ECONNRESET/i.test(msg)) {
        return true;
    }
    return false;
}

module.exports = { isTelegramNetworkError };
