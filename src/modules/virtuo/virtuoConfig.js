'use strict';

function envFlag(name, defaultOff = true) {
    const v = String(process.env[name] ?? (defaultOff ? '0' : '1')).toLowerCase();
    return v === '1' || v === 'true' || v === 'yes';
}

function envNumber(name, fallback) {
    const n = Number(process.env[name]);
    return Number.isFinite(n) ? n : fallback;
}

const VirtuoConfig = {
    _catalogCached: null,
    hasCachedCatalog() {
        if (this._catalogCached !== null) return this._catalogCached;
        try {
            const { connect } = require('../../config/database-sqlite');
            const row = connect()
                .prepare('SELECT 1 AS ok FROM virtuo_services WHERE active = 1 LIMIT 1')
                .get();
            this._catalogCached = !!row;
        } catch {
            this._catalogCached = false;
        }
        return this._catalogCached;
    },
    isEnabled() {
        const raw = String(process.env.VIRTUO_ENABLED ?? '').trim().toLowerCase();
        if (raw === '0' || raw === 'false' || raw === 'no') return false;
        if (raw === '1' || raw === 'true' || raw === 'yes') return true;
        if ((process.env.VIRTUO_API_KEY || '').trim()) return true;
        return this.hasCachedCatalog();
    },
    get apiKey() {
        return (process.env.VIRTUO_API_KEY || '').trim();
    },
    get apiUrl() {
        return (process.env.VIRTUO_API_URL || 'https://api.virtuoesim.com').replace(/\/+$/, '');
    },
    get apiTimeoutMs() {
        return envNumber('VIRTUO_API_TIMEOUT_MS', 30000);
    },
    get marginPercent() {
        return envNumber('VIRTUO_MARGIN_PERCENT', 40);
    },
    get minProfit() {
        return envNumber('VIRTUO_MIN_PROFIT', 2);
    },
    get catalogPageSize() {
        return Math.min(12, Math.max(4, envNumber('VIRTUO_CATALOG_PAGE_SIZE', 8)));
    },
    get publicAccess() {
        const v = String(process.env.VIRTUO_PUBLIC ?? '1').toLowerCase();
        return v === '1' || v === 'true' || v === 'yes';
    },
    get syncIntervalMs() {
        return envNumber('VIRTUO_SYNC_INTERVAL_MS', 6 * 60 * 60 * 1000);
    },
    get pollIntervalMs() {
        return envNumber('VIRTUO_POLL_INTERVAL_MS', 8000);
    },
    get pollTimeoutMs() {
        return envNumber('VIRTUO_POLL_TIMEOUT_MS', 30 * 60 * 1000);
    },
    get balanceMonitorEnabled() {
        return envFlag('VIRTUO_BALANCE_MONITOR', false);
    },
    get balanceMonitorMs() {
        return envNumber('VIRTUO_BALANCE_MONITOR_MS', 30 * 60 * 1000);
    },
    get balanceWarn() {
        return envNumber('VIRTUO_BALANCE_WARN', 30);
    },
    get balanceCritical() {
        return envNumber('VIRTUO_BALANCE_CRITICAL', 10);
    },
    get balanceWarnCooldownMs() {
        return envNumber('VIRTUO_BALANCE_WARN_COOLDOWN_MS', 6 * 60 * 60 * 1000);
    },
    get balanceCriticalCooldownMs() {
        return envNumber('VIRTUO_BALANCE_CRITICAL_COOLDOWN_MS', 2 * 60 * 60 * 1000);
    },
    get rechargeUrl() {
        return (process.env.VIRTUO_PROVIDER_RECHARGE_URL || 'https://sms.virtuoesim.com/').trim();
    },
    get defaultServer() {
        return envNumber('VIRTUO_DEFAULT_SERVER', 1);
    },
    /** @deprecated probes de ativação desativados — estoque via /prices apenas */
    get stockProbeAtCheckout() {
        return envFlag('VIRTUO_STOCK_PROBE_CHECKOUT', true);
    },
    get stockBlockTtlMs() {
        return envNumber('VIRTUO_STOCK_BLOCK_TTL_MS', 6 * 60 * 60 * 1000);
    },
    get stockProbeCacheMs() {
        return envNumber('VIRTUO_STOCK_PROBE_CACHE_MS', 15 * 60 * 1000);
    },
    get stockRecheckIntervalMs() {
        return envNumber('VIRTUO_STOCK_RECHECK_MS', 5 * 60 * 1000);
    },
    get stockRecheckBatch() {
        return Math.max(1, envNumber('VIRTUO_STOCK_RECHECK_BATCH', 15));
    },
    get stockProbeDelayMs() {
        return Math.max(250, envNumber('VIRTUO_STOCK_PROBE_DELAY_MS', 800));
    },
    get stockReconcileDelayMs() {
        return Math.max(100, envNumber('VIRTUO_STOCK_RECONCILE_DELAY_MS', 200));
    },
};

module.exports = VirtuoConfig;
