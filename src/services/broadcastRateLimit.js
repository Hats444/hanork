'use strict';

/**
 * Limite de divulgação automática por destino (PV, grupo, canal, ponte).
 * Janela deslizante — padrão: no máximo 2 envios a cada 12 horas por chatId.
 * Divulgação manual (admin) não usa este módulo (enforceAutoRateLimit: false).
 */

const { BROADCAST_RATE_WINDOW_MS, BROADCAST_MAX_PER_DESTINATION, isPvOnceDaily } = require('../config/broadcastConfig');
const BroadcastAdaptiveThrottle = require('./BroadcastAdaptiveThrottle');

const KV_PREFIX = 'bcast_hist:';

/** Intervalo mínimo entre envios NOVOS no mesmo chat (evita duplicata em <1 min). */
const MIN_PROMO_GAP_MS = Math.max(
    45_000,
    parseInt(process.env.BROADCAST_MIN_PROMO_GAP_MS || '90000', 10)
);

const SCHEDULED_SOURCES = new Set([
    'auto',
    'button_activate',
    'button_run_now',
    'hanork_router',
]);

function isScheduledBroadcastSource(source) {
    if (!source || source === 'auto') return true;
    if (SCHEDULED_SOURCES.has(source)) return true;
    const s = String(source);
    if (s.startsWith('button_')) return true;
    if (s.startsWith('campaign_')) return true;
    return false;
}

function getDb(dbRaw) {
    return typeof dbRaw === 'function' ? dbRaw() : dbRaw;
}

function normalizeHistory(raw, windowMs = BROADCAST_RATE_WINDOW_MS) {
    const now = Date.now();
    const cutoff = now - windowMs;
    return (raw || [])
        .map((ts) => (typeof ts === 'number' ? ts : new Date(ts).getTime()))
        .filter((t) => Number.isFinite(t) && t > cutoff);
}

function loadHistory(dbRaw, chatId, windowMs = BROADCAST_RATE_WINDOW_MS) {
    const db = getDb(dbRaw);
    if (!db || chatId == null) return [];
    try {
        const row = db.prepare('SELECT value FROM kv_store WHERE key=?').get(`${KV_PREFIX}${chatId}`);
        if (!row?.value) return [];
        const parsed = JSON.parse(row.value);
        return normalizeHistory(Array.isArray(parsed) ? parsed : [], windowMs);
    } catch {
        return [];
    }
}

function saveHistory(dbRaw, chatId, history) {
    const db = getDb(dbRaw);
    if (!db || chatId == null) return;
    db.prepare(
        `INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, datetime('now'))`
    ).run(`${KV_PREFIX}${chatId}`, JSON.stringify(history));
}

/**
 * @returns {{ ok: boolean, count: number, remaining?: number, waitMin?: number }}
 */
function resolveAdaptiveOpts(opts = {}) {
    const channel = opts.channel || 'default';
    BroadcastAdaptiveThrottle.bindDb(opts.dbRaw);
    const adaptive = BroadcastAdaptiveThrottle.getLimits(channel);
    return {
        maxPosts: opts.maxPosts ?? adaptive.maxPosts ?? BROADCAST_MAX_PER_DESTINATION,
        windowMs: opts.windowMs ?? adaptive.windowMs ?? BROADCAST_RATE_WINDOW_MS,
    };
}

function lastSendMs(hist) {
    if (!hist?.length) return 0;
    return Math.max(...hist);
}

function minGapBlocked(hist, minGapMs = MIN_PROMO_GAP_MS) {
    const last = lastSendMs(hist);
    if (!last) return null;
    const elapsed = Date.now() - last;
    if (elapsed >= minGapMs) return null;
    return {
        ok: false,
        allowEditOnly: true,
        reason: 'min_gap',
        waitSec: Math.ceil((minGapMs - elapsed) / 1000),
        lastSendMs: last,
    };
}

/**
 * @param {object} opts
 * @param {boolean} [opts.enforceWindow=true] — janela 12h (auto); manual pode desligar
 */
function canSendPromo(dbRaw, chatId, opts = {}) {
    const enforceWindow = opts.enforceWindow !== false;
    const minGapMs = opts.minGapMs ?? MIN_PROMO_GAP_MS;
    const histAll = loadHistory(dbRaw, chatId, 48 * 60 * 60 * 1000);
    const gap = minGapBlocked(histAll, minGapMs);
    if (gap) return { ...gap, count: histAll.length };

    if (!enforceWindow) {
        return {
            ok: true,
            allowEditOnly: false,
            count: histAll.length,
        };
    }

    const { maxPosts, windowMs } = resolveAdaptiveOpts({ ...opts, dbRaw });
    const hist = normalizeHistory(histAll, windowMs);
    if (hist.length >= maxPosts) {
        const oldest = Math.min(...hist);
        const waitMin = Math.ceil((oldest + windowMs - Date.now()) / 60000);
        const userChannel = opts.channel === 'user' || opts.channel === 'pv';
        const skipEdit = userChannel && isPvOnceDaily();
        return {
            ok: false,
            allowEditOnly: skipEdit ? false : true,
            reason: skipEdit ? 'pv_daily_cap' : 'window_limit',
            count: hist.length,
            waitMin: Math.max(0, waitMin),
            maxPosts,
            windowMs,
        };
    }
    return {
        ok: true,
        allowEditOnly: false,
        count: hist.length,
        remaining: maxPosts - hist.length,
        maxPosts,
        windowMs,
    };
}

function canSendAuto(dbRaw, chatId, opts = {}) {
    return canSendPromo(dbRaw, chatId, { ...opts, enforceWindow: true });
}

/** Registra apenas envio NOVO (sent) — edições não consomem cota anti-ban. */
function recordAutoSend(dbRaw, chatId, opts = {}) {
    if (opts.kind === 'edit') return;
    const { windowMs } = resolveAdaptiveOpts({ ...opts, dbRaw });
    const hist = loadHistory(dbRaw, chatId, windowMs);
    hist.push(Date.now());
    saveHistory(dbRaw, chatId, normalizeHistory(hist, windowMs));
}

module.exports = {
    KV_PREFIX,
    MIN_PROMO_GAP_MS,
    isScheduledBroadcastSource,
    canSendPromo,
    canSendAuto,
    recordAutoSend,
    loadHistory,
    BROADCAST_RATE_WINDOW_MS,
    BROADCAST_MAX_PER_DESTINATION,
};
