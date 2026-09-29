'use strict';

const logger = require('../config/logger');

const _inflight = new Set();

/**
 * Executa trabalho pesado fora do caminho crítico do handler Telegram.
 * Dedupe por label — evita rajadas (ex.: 40× refresh de painel).
 */
function deferBackground(label, fn, opts = {}) {
    const key = String(label || 'anon');
    if (!opts.force && _inflight.has(key)) return;
    _inflight.add(key);
    setImmediate(() => {
        Promise.resolve()
            .then(fn)
            .catch((err) => {
                logger.error(`[defer:${key}] ${err?.message || err}`);
            })
            .finally(() => {
                _inflight.delete(key);
            });
    });
}

module.exports = { deferBackground };
