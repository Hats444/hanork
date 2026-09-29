'use strict';

const axios = require('axios');
const logger = require('../config/logger');
const { isPersonaJunkResponse } = require('../utils/aiContentSanitizer');
const {
    parseIaApiBody,
    is429Error,
    isHtmlOrAuthError,
    isGatewayError,
    extractIaResponseText,
} = require('./zeroTwoIaResponse');

/**
 * Provedores IA Zero Two — failover igual rotas /play e /tiktok.
 * Parser: zeroTwoIaResponse.js (formatos gpt, gpt4, gemini, zerotwo).
 */
const DEFAULT_PROVIDERS = [
    { id: 'gpt', path: '/api/ia/gpt', priority: 100, label: 'gpt' },
    { id: 'gpt4', path: '/api/ia/gpt4', priority: 95, label: 'gpt4' },
    { id: 'gemini', path: '/gemini/texto/imagem', priority: 85, label: 'gemini' },
    {
        id: 'zerotwo',
        path: '/api/ia/zerotwo',
        priority: 70,
        label: 'zerotwo',
        timeoutMs: Math.max(12000, Number(process.env.ZEROTWO_AI_ZEROTWO_TIMEOUT_MS) || 35000),
    },
];

const PROVIDER_COOLDOWN_MS = Math.max(
    30000,
    Number(process.env.ZEROTWO_AI_PROVIDER_COOLDOWN_MS) || 90000
);
const PROVIDER_429_COOLDOWN_MS = Math.max(
    60000,
    Number(process.env.ZEROTWO_AI_PROVIDER_429_COOLDOWN_MS) || 180000
);
const GATEWAY_COOLDOWN_MS = Math.max(
    5000,
    Number(process.env.ZEROTWO_AI_GATEWAY_COOLDOWN_MS) || 20000
);
const GATEWAY_OUTAGE_MS = Math.max(
    30000,
    Number(process.env.ZEROTWO_AI_GATEWAY_OUTAGE_MS) || 120000
);

/** @type {Map<string, { disabledUntil: number, success: number, fail: number, timeout: number, totalMs: number }>} */
const _state = new Map();
let _gatewayOutageUntil = 0;
let _lastGatewayLogAt = 0;

function apiRoot(base) {
    return String(base || 'https://zero-two-apis.com.br').replace(/\/+$/, '');
}

function getProviders() {
    const env = String(process.env.ZEROTWO_AI_PROVIDERS || '').trim();
    if (!env) return [...DEFAULT_PROVIDERS];
    const ids = env.split(',').map((s) => s.trim()).filter(Boolean);
    const list = ids
        .map((id) => DEFAULT_PROVIDERS.find((p) => p.id === id))
        .filter(Boolean);
    return list.length ? list : [...DEFAULT_PROVIDERS];
}

function parseRetryAfter(headers) {
    const h = headers?.['retry-after'] ?? headers?.['Retry-After'];
    const n = Number(h);
    if (Number.isFinite(n) && n > 0) return Math.min(n, 600);
    return null;
}

function getProviderState(id) {
    if (!_state.has(id)) {
        _state.set(id, { disabledUntil: 0, success: 0, fail: 0, timeout: 0, totalMs: 0 });
    }
    return _state.get(id);
}

function isProviderAvailable(id) {
    const s = getProviderState(id);
    return !s.disabledUntil || Date.now() >= s.disabledUntil;
}

function markProviderSuccess(id, ms) {
    const s = getProviderState(id);
    s.success++;
    s.totalMs += ms;
    s.disabledUntil = 0;
}

function markProviderFail(id, { is429 = false, isTimeout = false, isGateway = false, retryAfterSec = null } = {}) {
    const s = getProviderState(id);
    s.fail++;
    if (isTimeout) s.timeout++;
    const base = isGateway
        ? GATEWAY_COOLDOWN_MS
        : is429
          ? PROVIDER_429_COOLDOWN_MS
          : PROVIDER_COOLDOWN_MS;
    const extra = retryAfterSec ? retryAfterSec * 1000 : base;
    s.disabledUntil = Math.max(s.disabledUntil || 0, Date.now() + extra);
}

function noteGatewayFailure() {
    _gatewayOutageUntil = Date.now() + GATEWAY_OUTAGE_MS;
    const now = Date.now();
    if (now - _lastGatewayLogAt >= 60000) {
        _lastGatewayLogAt = now;
        logger.info('[ZeroTwo AI] gateway indisponível — usando template', {
            outageSec: Math.round(GATEWAY_OUTAGE_MS / 1000),
        });
    }
}

function isGatewayOutage() {
    return _gatewayOutageUntil > Date.now();
}

function gatewayOutageRemainingMs() {
    return Math.max(0, _gatewayOutageUntil - Date.now());
}

function successRate(id) {
    const s = getProviderState(id);
    const total = s.success + s.fail;
    if (!total) return 0.5;
    return s.success / total;
}

function rotateProviderList(list, rotateIndex = 0) {
    if (!list?.length || list.length < 2) return list || [];
    const i = Math.abs(Number(rotateIndex) || 0) % list.length;
    if (!i) return list;
    return [...list.slice(i), ...list.slice(0, i)];
}

/** Ordem do .env; opcional rotação por produto (espalha carga entre as 4 IAs). */
function sortedProviders(options = {}) {
    const all = getProviders();
    const available = all.filter((p) => isProviderAvailable(p.id));
    let list = available.length ? available : all;
    const envOrder = String(process.env.ZEROTWO_AI_PROVIDERS || '').trim();
    if (!envOrder) {
        list = [...list].sort((a, b) => {
            const rateDiff = successRate(b.id) - successRate(a.id);
            if (Math.abs(rateDiff) > 0.05) return rateDiff;
            return b.priority - a.priority;
        });
    }
    try {
        const providerHub = require('../core/hanorkAiCore/providerHub');
        if (!envOrder && providerHub.isHealthSortEnabled()) {
            list = providerHub.sortProvidersByHealth(list);
        }
    } catch {
        /* B4 optional */
    }
    return rotateProviderList(list, options.rotateIndex);
}

function buildUrl(apiBase, path, query, apiKey) {
    return `${apiRoot(apiBase)}${path}?query=${encodeURIComponent(query)}&apikey=${encodeURIComponent(apiKey)}`;
}

function providerTimeout(provider, defaultTimeout) {
    if (provider?.timeoutMs != null && Number.isFinite(Number(provider.timeoutMs))) {
        return Number(provider.timeoutMs);
    }
    return defaultTimeout;
}

function normalizeResponseData(data) {
    if (typeof data === 'string') {
        const s = data.trim();
        if (s.startsWith('{') || s.startsWith('[')) {
            try {
                return JSON.parse(s);
            } catch {
                return data;
            }
        }
    }
    return data;
}

function parseGptBody(data, httpStatus, headers) {
    const body = parseIaApiBody(data, httpStatus, headers);
    if (isPersonaJunkResponse(body)) {
        throw new Error('Resposta persona/indisponível da API');
    }
    return body;
}

async function executeWithFailover({ apiBase, apiKey, query, timeout, rotateIndex = 0, productId = null }) {
    if (isGatewayOutage()) {
        const err = new Error('API gateway indisponível (502/503/504)');
        err.code = 'GATEWAY_OUTAGE';
        throw err;
    }

    const providers = sortedProviders({
        rotateIndex: rotateIndex ?? productId ?? 0,
    });
    let lastErr;
    let tried = 0;

    if (providers.length) {
        logger.debug('[ZeroTwo AI] cadeia IA', {
            order: providers.map((p) => p.label),
            productId: productId ?? null,
        });
    }

    const chain = providers.filter((p) => isProviderAvailable(p.id));
    const totalInChain = chain.length;

    for (const provider of chain) {
        tried++;
        const isLast = tried >= totalInChain;
        const url = buildUrl(apiBase, provider.path, query, apiKey);
        const reqTimeout = providerTimeout(provider, timeout);
        const t0 = Date.now();
        let httpStatus = null;
        let rawPayload = null;
        try {
            const res = await axios.get(url, {
                timeout: reqTimeout,
                validateStatus: () => true,
            });
            httpStatus = res?.status;
            rawPayload = normalizeResponseData(res?.data);
            const body = parseGptBody(rawPayload, httpStatus, res?.headers);
            const ms = Date.now() - t0;
            markProviderSuccess(provider.id, ms);
            if (tried > 1) {
                logger.info('[ZeroTwo AI] failover ok', {
                    provider: provider.label,
                    ms,
                    attempt: tried,
                });
            }
            return { body, ms, providerId: provider.id, providerLabel: provider.label };
        } catch (e) {
            lastErr = e;
            const ms = Date.now() - t0;
            const isTimeout = e?.code === 'ECONNABORTED' || /timeout/i.test(e?.message || '');
            const retryAfter = parseRetryAfter(e?.response?.headers);
            const payload = normalizeResponseData(e?.response?.data ?? rawPayload);
            const httpCode = e?.response?.status ?? httpStatus;
            const isGateway =
                e?.code === 'GATEWAY_OUTAGE' ||
                isGatewayError(payload, httpCode) ||
                isGatewayError(rawPayload, httpStatus);
            const is429 = !isGateway && is429Error(e, payload, httpCode, e?.response?.headers);
            markProviderFail(provider.id, { is429, isTimeout, isGateway, retryAfterSec: retryAfter });
            const logFn = isLast ? logger.warn.bind(logger) : logger.debug.bind(logger);
            if (isGateway) {
                noteGatewayFailure();
                if (!lastErr || lastErr.code !== 'GATEWAY_OUTAGE') {
                    lastErr = new Error('API gateway indisponível (502/503/504)');
                    lastErr.code = 'GATEWAY_OUTAGE';
                }
                break;
            }
            if (is429) {
                logFn('[ZeroTwo AI] provider 429 — próximo', {
                    provider: provider.label,
                    sec: Math.round((retryAfter ? retryAfter * 1000 : PROVIDER_429_COOLDOWN_MS) / 1000),
                    last: isLast,
                });
            } else {
                const apiDetail =
                    payload?.error?.message ||
                    payload?.message ||
                    (typeof payload === 'string' ? payload.slice(0, 160) : null) ||
                    (rawPayload && typeof rawPayload === 'object'
                        ? JSON.stringify(rawPayload).slice(0, 160)
                        : null);
                logFn('[ZeroTwo AI] provider fail — próximo', {
                    provider: provider.label,
                    ms,
                    err: apiDetail || e?.message || 'erro',
                    httpStatus: e?.response?.status ?? httpStatus,
                    isTimeout,
                    last: isLast,
                });
            }
        }
    }

    const err = lastErr || new Error('Todos os provedores GPT indisponíveis');
    if (isGatewayOutage() && err.code !== 'GATEWAY_OUTAGE') {
        err.code = 'GATEWAY_OUTAGE';
    }
    throw err;
}

function hasAvailableProvider() {
    return getProviders().some((p) => isProviderAvailable(p.id));
}

function getProviderStats() {
    const out = {};
    for (const p of getProviders()) {
        const s = getProviderState(p.id);
        const total = s.success + s.fail;
        out[p.id] = {
            label: p.label,
            path: p.path,
            success: s.success,
            fail: s.fail,
            timeout: s.timeout,
            avgMs: s.success ? Math.round(s.totalMs / s.success) : 0,
            successRate: total ? Math.round((s.success / total) * 100) : null,
            disabledUntil: s.disabledUntil || 0,
            available: isProviderAvailable(p.id),
        };
    }
    return out;
}

function getProviderHealthReport() {
    try {
        return require('../core/hanorkAiCore/providerHub').getHealthReport();
    } catch {
        return null;
    }
}

module.exports = {
    DEFAULT_PROVIDERS,
    getProviders,
    executeWithFailover,
    hasAvailableProvider,
    isGatewayOutage,
    gatewayOutageRemainingMs,
    getProviderStats,
    getProviderHealthReport,
    sortedProviders,
    rotateProviderList,
    is429Error,
    parseRetryAfter,
    parseGptBody,
    extractRawText: extractIaResponseText,
    isHtmlOrAuthError,
};
