'use strict';

/**
 * Throttle adaptativo unificado — Telegram (grupos/PV/canais/ponte) + sinais WA.
 * Perfis: safe | balanced | aggressive (ZERO_DIVU_PROFILE).
 */

const logger = require('../config/logger');
const { resolvePvUserDelayMs } = require('../config/broadcastConfig');

const HOUR = 3600000;
const KV_RISK = 'broadcast_adaptive:risk_score';
const KV_SIGNAL = 'broadcast_adaptive:last_signal';

const PROFILES = {
    safe: {
        label: 'safe',
        maxNewPerWindow: 1,
        windowMs: 24 * HOUR,
        userDelayMs: 60000,
        groupDelayMs: 2800,
        channelDelayMs: 3200,
        bridgeDelayMs: 2800,
        retryPartialMs: 50 * 60 * 1000,
    },
    balanced: {
        label: 'balanced',
        maxNewPerWindow: 2,
        windowMs: 12 * HOUR,
        userDelayMs: 60000,
        groupDelayMs: 2800,
        channelDelayMs: 3200,
        bridgeDelayMs: 2500,
        retryPartialMs: 45 * 60 * 1000,
    },
    aggressive: {
        label: 'aggressive',
        maxNewPerWindow: 2,
        windowMs: 10 * HOUR,
        userDelayMs: 60000,
        groupDelayMs: 2200,
        channelDelayMs: 2600,
        bridgeDelayMs: 2000,
        retryPartialMs: 35 * 60 * 1000,
    },
};

let _riskScore = 0;
let _lastSignalAt = 0;
let _dbRaw = null;

function resolveProfileName() {
    const p = String(process.env.ZERO_DIVU_PROFILE || process.env.BROADCAST_THROTTLE_PROFILE || 'balanced')
        .trim()
        .toLowerCase();
    return PROFILES[p] ? p : 'balanced';
}

function getProfile() {
    return PROFILES[resolveProfileName()];
}

function bindDb(dbRaw) {
    if (dbRaw) _dbRaw = dbRaw;
}

function _db() {
    return typeof _dbRaw === 'function' ? _dbRaw() : null;
}

function _writeIpcState() {
    const dir = process.env.ZERO_DIVU_IPC_DIR;
    if (!dir) return;
    try {
        const fs = require('fs');
        const path = require('path');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(
            path.join(dir, 'hanork-throttle.json'),
            JSON.stringify({
                riskScore: _riskScore,
                profile: resolveProfileName(),
                updatedAt: Date.now(),
            })
        );
    } catch {
        /* ignore */
    }
}

function _syncFromWaState() {
    const dir = process.env.ZERO_DIVU_IPC_DIR;
    if (!dir) return;
    try {
        const fs = require('fs');
        const path = require('path');
        let waRisk = 0;
        try {
            const raw = fs.readFileSync(path.join(dir, 'state.json'), 'utf8');
            const st = JSON.parse(raw);
            waRisk = Number(st?.riskScore ?? st?.antiBan?.riskScore ?? 0);
        } catch {
            /* ignore */
        }
        try {
            const wt = JSON.parse(fs.readFileSync(path.join(dir, 'wa-throttle.json'), 'utf8'));
            if (Date.now() - (Number(wt.updatedAt) || 0) < 45 * 60 * 1000) {
                waRisk = Math.max(waRisk, Number(wt.riskScore) || 0);
            }
        } catch {
            /* ignore */
        }
        if (waRisk > _riskScore + 12) {
            _riskScore = Math.min(100, Math.max(_riskScore, Math.round(waRisk * 0.85)));
        }
    } catch {
        /* ignore */
    }
}

function _persistRisk() {
    const db = _db();
    if (db) {
        try {
            db.prepare(
                `INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, datetime('now'))`
            ).run(KV_RISK, String(_riskScore));
            db.prepare(
                `INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, datetime('now'))`
            ).run(KV_SIGNAL, String(_lastSignalAt || Date.now()));
        } catch {
            /* ignore */
        }
    }
    _writeIpcState();
}

function _loadRisk() {
    const db = _db();
    if (!db) return;
    try {
        const row = db.prepare('SELECT value FROM kv_store WHERE key=?').get(KV_RISK);
        _riskScore = Math.min(100, Math.max(0, parseInt(row?.value || '0', 10) || 0));
    } catch {
        /* ignore */
    }
}

function riskFactor() {
    if (_riskScore >= 80) return 0.35;
    if (_riskScore >= 60) return 0.55;
    if (_riskScore >= 40) return 0.75;
    if (_riskScore >= 20) return 0.9;
    return 1;
}

/**
 * @param {string} signal — ex: tg_flood, wa_unstable, wa_rate_limit, bridge_stars
 * @param {{ severity?: number }} [meta]
 */
function recordSignal(signal, meta = {}) {
    const sev = Math.min(40, Math.max(5, Number(meta.severity) || 15));
    const decay = _lastSignalAt && Date.now() - _lastSignalAt > 30 * 60 * 1000 ? -8 : 0;
    _riskScore = Math.min(100, Math.max(0, _riskScore + sev + decay));
    _lastSignalAt = Date.now();
    _persistRisk();
    logger.info('[BroadcastThrottle] sinal registrado', {
        signal,
        riskScore: _riskScore,
        profile: resolveProfileName(),
    });
}

function recordSuccess(channel = 'tg') {
    const drop = channel === 'wa' ? 12 : 6;
    _riskScore = Math.max(0, _riskScore - drop);
    _persistRisk();
}

function getLimits(channel = 'default') {
    _loadRisk();
    _syncFromWaState();
    const base = getProfile();
    const factor = riskFactor();
    const maxPosts = Math.max(1, Math.round(base.maxNewPerWindow * factor));
    const windowMs = Math.round(base.windowMs / factor);

    const delayScale = factor < 1 ? 1 / factor : 1;
    const delays = {
        userDelayMs: resolvePvUserDelayMs(Math.round(base.userDelayMs * delayScale)),
        groupDelayMs: Math.round(base.groupDelayMs * delayScale),
        channelDelayMs: Math.round(base.channelDelayMs * delayScale),
        bridgeDelayMs: Math.round(base.bridgeDelayMs * delayScale),
    };

    if (channel === 'user' || channel === 'pv') {
        return { maxPosts, windowMs, delayMs: delays.userDelayMs, profile: base.label, riskScore: _riskScore };
    }
    if (channel === 'group') {
        return { maxPosts, windowMs, delayMs: delays.groupDelayMs, profile: base.label, riskScore: _riskScore };
    }
    if (channel === 'channel') {
        return { maxPosts, windowMs, delayMs: delays.channelDelayMs, profile: base.label, riskScore: _riskScore };
    }
    if (channel === 'bridge') {
        return { maxPosts, windowMs, delayMs: delays.bridgeDelayMs, profile: base.label, riskScore: _riskScore };
    }
    return { maxPosts, windowMs, ...delays, profile: base.label, riskScore: _riskScore };
}

function getPartialRetryMs() {
    const base = getProfile();
    const factor = riskFactor();
    return Math.round(base.retryPartialMs / factor);
}

function statusLine() {
    const lim = getLimits();
    return `perfil <b>${lim.profile}</b> · risco <b>${lim.riskScore}/100</b> · máx <b>${lim.maxPosts}</b> novos/${Math.round(lim.windowMs / HOUR)}h`;
}

function mapErrorToSignal(errText) {
    const u = String(errText || '').toUpperCase();
    if (/\bFLOOD\b/.test(u)) return { signal: 'tg_flood', severity: 25 };
    if (u.includes('ALLOW_PAYMENT') || u.includes('STARS')) return { signal: 'tg_stars', severity: 10 };
    if (u.includes('WA_UNSTABLE') || u.includes('408')) return { signal: 'wa_unstable', severity: 20 };
    if (u.includes('RATE_LIMIT') || u.includes('429')) return { signal: 'wa_rate_limit', severity: 22 };
    if (u.includes('CONNECTION CLOSED') || u.includes('500')) return { signal: 'wa_disconnect', severity: 18 };
    return null;
}

module.exports = {
    PROFILES,
    bindDb,
    getProfile,
    getLimits,
    getPartialRetryMs,
    recordSignal,
    recordSuccess,
    riskFactor,
    statusLine,
    mapErrorToSignal,
    resolveProfileName,
};
