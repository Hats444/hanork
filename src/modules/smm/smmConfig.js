'use strict';

function envFlag(name, defaultOff = true) {
    const v = String(process.env[name] ?? (defaultOff ? '0' : '1')).toLowerCase();
    return v === '1' || v === 'true' || v === 'yes';
}

function envNumber(name, fallback) {
    const n = Number(process.env[name]);
    return Number.isFinite(n) ? n : fallback;
}

const SmmConfig = {
    isEnabled() {
        return envFlag('SMM_ENABLED', true);
    },
    get marginPercent() {
        return envNumber('SMM_MARGIN_PERCENT', 50);
    },
    get minProfit() {
        return envNumber('SMM_MIN_PROFIT', 10);
    },
    get catalogPageSize() {
        return Math.min(20, Math.max(5, envNumber('SMM_CATALOG_PAGE_SIZE', 10)));
    },
    get autoImportOnBoot() {
        return envFlag('SMM_AUTO_IMPORT', true);
    },
    get providerKey() {
        return (process.env.FORNECEDOR_BRASIL_API_KEY || '').trim();
    },
    get apiUrl() {
        return (process.env.FORNECEDOR_BRASIL_API_URL || 'https://fornecedorbrasil.com/api/v2').trim();
    },
    get apiTimeoutMs() {
        return envNumber('FORNECEDOR_BRASIL_TIMEOUT_MS', 30000);
    },
    get catalogJsonPath() {
        const path = require('path');
        return process.env.SMM_CATALOG_JSON_PATH
            || path.join(__dirname, '../../../api/api/export/all-services.json');
    },
    get defaultProvider() {
        return 'fornecedorbrasil';
    },
    get cacheTtlSec() {
        return envNumber('SMM_CACHE_TTL_SEC', 300);
    },
    /** Monitor de pedidos abertos (Pending/Processing/Partial) */
    get orderMonitorIntervalMs() {
        return envNumber('SMM_ORDER_MONITOR_MS', 10 * 60 * 1000);
    },
    /** Sincronização de catálogo com API/JSON */
    get syncIntervalMs() {
        return envNumber('SMM_SYNC_INTERVAL_MS', 6 * 60 * 60 * 1000);
    },
    get orderMonitorBatchSize() {
        return Math.min(100, Math.max(10, envNumber('SMM_ORDER_MONITOR_BATCH', 50)));
    },
    /** Pedido pago sem envio ao fornecedor — watchdog carteira */
    get stuckFulfillMinutes() {
        return envNumber('SMM_STUCK_FULFILL_MINUTES', 45);
    },
    get stuckFulfillBatchSize() {
        return Math.min(30, Math.max(5, envNumber('SMM_STUCK_FULFILL_BATCH', 15)));
    },
    get duplicateWindowMinutes() {
        return envNumber('SMM_DUPLICATE_WINDOW_MIN', 15);
    },
    get rateLimitMax() {
        return envNumber('SMM_RATE_LIMIT_MAX', 20);
    },
    get rateLimitWindowSec() {
        return envNumber('SMM_RATE_LIMIT_WINDOW_SEC', 60);
    },
    get refillMonitorIntervalMs() {
        return envNumber('SMM_REFILL_MONITOR_MS', 15 * 60 * 1000);
    },
    get refillMonitorBatchSize() {
        return Math.min(50, Math.max(5, envNumber('SMM_REFILL_MONITOR_BATCH', 30)));
    },
    /** SMM_PUBLIC=0 restringe a admins; padrão 1 = aberto (alinhado com smmAccess.js) */
    get publicAccess() {
        const v = String(process.env.SMM_PUBLIC ?? '1').toLowerCase();
        return v === '1' || v === 'true' || v === 'yes';
    },
    /** Monitor de saúde dos serviços (onda D) */
    get healthMonitorIntervalMs() {
        return envNumber('SMM_HEALTH_MONITOR_MS', 60 * 60 * 1000);
    },
    get healthWindowDays() {
        return envNumber('SMM_HEALTH_WINDOW_DAYS', 30);
    },
    get healthMinSamples() {
        return envNumber('SMM_HEALTH_MIN_SAMPLES', 5);
    },
    get healthWarningRate() {
        return envNumber('SMM_HEALTH_WARNING_RATE', 0.15);
    },
    get healthDegradedRate() {
        return envNumber('SMM_HEALTH_DEGRADED_RATE', 0.35);
    },
    get healthDisableRate() {
        return envNumber('SMM_HEALTH_DISABLE_RATE', 0.5);
    },
    get healthAutoDisable() {
        return envFlag('SMM_HEALTH_AUTO_DISABLE', false);
    },
    /** Máx. tentativas de failover por pedido (evita famílias gigantes) */
    get failoverMaxCandidates() {
        return Math.min(20, Math.max(3, envNumber('SMM_FAILOVER_MAX_CANDIDATES', 8)));
    },
    /** Monitor de saldo do fornecedor (PV admin + link recarga) */
    get balanceMonitorIntervalMs() {
        return envNumber('SMM_BALANCE_MONITOR_MS', 30 * 60 * 1000);
    },
    get balanceWarnThreshold() {
        return envNumber('SMM_BALANCE_WARN', 50);
    },
    get balanceCriticalThreshold() {
        return envNumber('SMM_BALANCE_CRITICAL', 15);
    },
    get balanceWarnCooldownMs() {
        return envNumber('SMM_BALANCE_WARN_COOLDOWN_MS', 6 * 60 * 60 * 1000);
    },
    get balanceCriticalCooldownMs() {
        return envNumber('SMM_BALANCE_CRITICAL_COOLDOWN_MS', 2 * 60 * 60 * 1000);
    },
    get providerRechargeUrl() {
        const url = (process.env.SMM_PROVIDER_RECHARGE_URL || 'https://fornecedorbrasil.com/').trim();
        return url || 'https://fornecedorbrasil.com/';
    },
    get upFamaApiKey() {
        return (process.env.UP_FAMA_API_KEY || '').trim();
    },
    get upFamaApiUrl() {
        return (process.env.UP_FAMA_API_URL || 'https://upfamadigital.com/api/v2').trim();
    },
    get upFamaTimeoutMs() {
        return envNumber('UP_FAMA_TIMEOUT_MS', 30000);
    },
    get upFamaRechargeUrl() {
        return (process.env.UP_FAMA_RECHARGE_URL || 'https://upfamadigital.com/').trim();
    },
    /** auto | ssm | up — fallback automático quando auto (padrão) */
    get providerMode() {
        const v = String(process.env.SMM_PROVIDER_MODE || 'auto').toLowerCase();
        if (v === 'ssm' || v === 'up') return v;
        return 'auto';
    },
    /** 1 = habilita segundo provedor quando UP_FAMA_API_KEY existe */
    get dualProviderEnabled() {
        return envFlag('SMM_DUAL_PROVIDER', true);
    },
    /** Mescla catálogos [SSM]/[UP] na sync e listagens ao vivo */
    get dualCatalogMerge() {
        return envFlag('SMM_DUAL_CATALOG', false);
    },
    /** TTL cache de serviços por provedor (ms) — padrão 15 min */
    get providerServicesCacheTtlMs() {
        return envNumber('SMM_PROVIDER_SERVICES_CACHE_MS', 15 * 60 * 1000);
    },
    get serviceMappingPath() {
        const p = require('path');
        return process.env.SMM_SERVICE_MAPPING_PATH
            || p.join(__dirname, 'config/serviceMapping.json');
    },
};

module.exports = SmmConfig;
