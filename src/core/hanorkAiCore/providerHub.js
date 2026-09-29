'use strict';

/**
 * B4 AI-V4.3 — Provider Hub (health scoring sobre GptProviderPool).
 */
const GptProviderPool = require('../../services/GptProviderPool');

const DEPRIORITIZE_SCORE = Number(process.env.ZEROTWO_AI_HEALTH_MIN_SCORE) || 0.3;
const DEPRIORITIZE_MS = Number(process.env.ZEROTWO_AI_HEALTH_DEPRIORITIZE_MS) || 15 * 60 * 1000;

/** @type {Map<string, number>} providerId → disabledUntil */
const _deprioritized = new Map();

function computeHealthScore(stats) {
    if (!stats) return 0.5;
    const total = (stats.success || 0) + (stats.fail || 0);
    const successRate = total > 0 ? stats.success / total : 0.5;
    const latencyP95Approx = stats.avgMs || 5000;
    const latencyFactor = 1 / Math.max(500, Math.min(latencyP95Approx, 45000));
    const failRate = total > 0 ? stats.fail / total : 0;
    const rateLimitFactor = 1 / (1 + failRate * 2);
    return successRate * 0.5 + latencyFactor * 3000 * 0.3 + rateLimitFactor * 0.2;
}

function refreshDeprioritization() {
    const now = Date.now();
    const stats = GptProviderPool.getProviderStats();
    for (const [id, s] of Object.entries(stats)) {
        const score = computeHealthScore(s);
        if (score < DEPRIORITIZE_SCORE && (s.success + s.fail) >= 3) {
            _deprioritized.set(id, now + DEPRIORITIZE_MS);
        } else if (score >= DEPRIORITIZE_SCORE + 0.15) {
            _deprioritized.delete(id);
        }
    }
}

function isDeprioritized(providerId) {
    const until = _deprioritized.get(providerId);
    if (!until) return false;
    if (Date.now() >= until) {
        _deprioritized.delete(providerId);
        return false;
    }
    return true;
}

function isHealthSortEnabled() {
    const v = String(process.env.ZEROTWO_AI_HEALTH_SORT ?? '1').trim().toLowerCase();
    return v !== '0' && v !== 'false';
}

function sortProvidersByHealth(providers) {
    refreshDeprioritization();
    return [...providers].sort((a, b) => {
        const sa = GptProviderPool.getProviderStats()[a.id] || {};
        const sb = GptProviderPool.getProviderStats()[b.id] || {};
        const depA = isDeprioritized(a.id) ? 1 : 0;
        const depB = isDeprioritized(b.id) ? 1 : 0;
        if (depA !== depB) return depA - depB;
        return computeHealthScore(sb) - computeHealthScore(sa);
    });
}

function getHealthReport() {
    refreshDeprioritization();
    const stats = GptProviderPool.getProviderStats();
    const providers = [];
    for (const [id, s] of Object.entries(stats)) {
        providers.push({
            id,
            ...s,
            healthScore: Math.round(computeHealthScore(s) * 1000) / 1000,
            deprioritized: isDeprioritized(id),
        });
    }
    providers.sort((a, b) => b.healthScore - a.healthScore);
    return {
        healthSort: isHealthSortEnabled(),
        deprioritizeThreshold: DEPRIORITIZE_SCORE,
        providers,
    };
}

module.exports = {
    computeHealthScore,
    isHealthSortEnabled,
    sortProvidersByHealth,
    getHealthReport,
    isDeprioritized,
};
