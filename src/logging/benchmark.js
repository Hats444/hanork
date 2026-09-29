'use strict';

/**
 * Utilitários de benchmarking — uso: const { bench, benchSync } = require('./logging/benchmark');
 */
function createBenchmark(logger) {
    async function bench(label, fn, opts = {}) {
        const start = performance.now();
        try {
            const result = await fn();
            const ms = performance.now() - start;
            logger.performance(label, ms, opts);
            return result;
        } catch (err) {
            const ms = performance.now() - start;
            logger.error(`[PERF] ${label} failed after ${ms.toFixed(1)}ms`, {
                error: err.message,
            });
            throw err;
        }
    }

    function benchSync(label, fn, opts = {}) {
        const start = performance.now();
        try {
            const result = fn();
            const ms = performance.now() - start;
            logger.performance(label, ms, opts);
            return result;
        } catch (err) {
            const ms = performance.now() - start;
            logger.error(`[PERF] ${label} failed after ${ms.toFixed(1)}ms`, {
                error: err.message,
            });
            throw err;
        }
    }

    return { bench, benchSync };
}

module.exports = { createBenchmark };
