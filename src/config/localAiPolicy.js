'use strict';

const fs = require('fs');
const os = require('os');

const WSL_MIN_TOTAL_MB = Number(process.env.OLLAMA_MIN_TOTAL_RAM_MB) || 6144;
const MIN_FREE_MB = Number(process.env.OLLAMA_MIN_FREE_RAM_MB) || 1800;

function isWsl() {
    try {
        return fs.readFileSync('/proc/version', 'utf8').toLowerCase().includes('microsoft');
    } catch {
        return false;
    }
}

function memStatsMb() {
    const total = Math.round(os.totalmem() / 1024 / 1024);
    const free = Math.round(os.freemem() / 1024 / 1024);
    return { total, free };
}

function isLocalAiEnvEnabled() {
    const v = String(process.env.USE_LOCAL_AI ?? 'false').trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes';
}

function allowsLocalAi() {
    if (!isLocalAiEnvEnabled()) {
        return { ok: false, reason: 'env_disabled' };
    }

    const { total, free } = memStatsMb();
    if (isWsl() && total < WSL_MIN_TOTAL_MB) {
        return { ok: false, reason: 'wsl_low_ram', totalMb: total, needMb: WSL_MIN_TOTAL_MB };
    }
    if (free < MIN_FREE_MB) {
        return { ok: false, reason: 'low_free_ram', freeMb: free, needMb: MIN_FREE_MB };
    }

    return { ok: true, totalMb: total, freeMb: free };
}

function getRecommendedModel() {
    return String(process.env.OLLAMA_MODEL || 'qwen2.5:0.5b').trim() || 'qwen2.5:0.5b';
}

function describeMode() {
    const gate = allowsLocalAi();
    if (gate.ok) {
        return {
            mode: 'ollama_fallback',
            model: getRecommendedModel(),
            message: `IA local permitida (${gate.totalMb}MB RAM) — fallback Ollama: ${getRecommendedModel()}`,
        };
    }
    if (!isLocalAiEnvEnabled()) {
        return {
            mode: 'api',
            message: 'IA via API Zero Two (USE_LOCAL_AI=0)',
        };
    }
    return {
        mode: 'api',
        message: `IA local bloqueada (${gate.reason}) — API Zero Two`,
        gate,
    };
}

module.exports = {
    isWsl,
    memStatsMb,
    isLocalAiEnvEnabled,
    allowsLocalAi,
    getRecommendedModel,
    describeMode,
};
