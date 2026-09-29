'use strict';

/**
 * Placeholder — detecção de preço ocorre no syncCatalog (smm_price_history).
 */
async function runPriceMonitorJob() {
    return { ok: true, via: 'sync_catalog' };
}

module.exports = { runPriceMonitorJob };
