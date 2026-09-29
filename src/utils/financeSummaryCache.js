'use strict';

const TTL_MS = Math.max(15000, Number(process.env.FINANCE_SUMMARY_CACHE_MS) || 60000);

let _cache = { at: 0, data: { income: 0, expense: 0 } };

async function getCashFlowToday(prisma) {
    const now = Date.now();
    if (now - _cache.at < TTL_MS) return _cache.data;
    if (!prisma?.finance?.getCashFlowSummary) return _cache.data;
    const data = await prisma.finance.getCashFlowSummary('today');
    _cache = { at: now, data: data || { income: 0, expense: 0 } };
    return _cache.data;
}

function invalidateFinanceSummaryCache() {
    _cache.at = 0;
}

module.exports = { getCashFlowToday, invalidateFinanceSummaryCache };
