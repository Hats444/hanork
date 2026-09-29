'use strict';

require('./env');

/**
 * Intervalos de divulgação automática (anti-ban Telegram).
 * Padrão: ciclo a cada 2h + no máximo 2 posts por destino a cada 12h.
 * Divulgação manual (botões admin) ignora o limite por destino.
 */

const HOUR = 3600000;
const MIN_MS = HOUR; // mínimo 1h — não aceita valor menor no .env
const MAX_MS = 24 * HOUR;
const DEFAULT_INTERVAL_MS = 2 * HOUR;
const DEFAULT_RATE_WINDOW_MS = 24 * HOUR;
const DEFAULT_MAX_PER_DESTINATION = 1;

function clampInt(raw, fallback) {
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : fallback;
}

function resolveIntervalMs() {
    const raw = process.env.AUTO_BROADCAST_INTERVAL_MS;
    const val = raw != null && String(raw).trim() !== '' ? clampInt(raw, DEFAULT_INTERVAL_MS) : DEFAULT_INTERVAL_MS;
    return Math.min(MAX_MS, Math.max(MIN_MS, val));
}

/** Mínimo entre PVs — 1 min/membro (anti-flood Telegram). */
const PV_USER_DELAY_MIN_MS = 60000;
const PV_USER_DELAY_DEFAULT_MS = 60000;

function resolveAutoDelays() {
    return {
        userDelayMs: Math.max(
            PV_USER_DELAY_MIN_MS,
            clampInt(process.env.AUTO_BROADCAST_USER_DELAY_MS, PV_USER_DELAY_DEFAULT_MS)
        ),
        groupDelayMs: Math.max(1200, clampInt(process.env.AUTO_BROADCAST_GROUP_DELAY_MS, 2800)),
        channelDelayMs: Math.max(1500, clampInt(process.env.AUTO_BROADCAST_CHANNEL_DELAY_MS, 3200)),
    };
}

/** Jitter 0–25% do delay base por job (anti-padrão). */
function resolvePvJitterRatio() {
    const raw = parseFloat(process.env.BROADCAST_PV_JITTER_RATIO || '0.25', 10);
    if (!Number.isFinite(raw)) return 0.25;
    return Math.min(0.5, Math.max(0, raw));
}

/** Pausa mínima após cada entrega PV (worker serial) — padrão = mesmo delay entre membros. */
function resolvePvMinGapMs() {
    const raw = process.env.BROADCAST_PV_MIN_GAP_MS;
    if (raw != null && String(raw).trim() !== '') {
        return Math.max(0, clampInt(raw, PV_USER_DELAY_DEFAULT_MS));
    }
    return resolvePvUserDelayMs();
}

/** 0 = sem limite; >0 corta fila por ciclo (resto no retry parcial). */
function resolveMaxUsersPerCycle() {
    const raw = process.env.AUTO_BROADCAST_MAX_USERS_PER_CYCLE;
    if (raw == null || String(raw).trim() === '') return 0;
    return Math.max(0, clampInt(raw, 0));
}

function resolvePvUserDelayMs(overrideMs) {
    const base = resolveAutoDelays().userDelayMs;
    if (overrideMs == null || !Number.isFinite(Number(overrideMs))) return base;
    return Math.max(PV_USER_DELAY_MIN_MS, base, Math.round(Number(overrideMs)));
}

function resolveRateWindowMs() {
    const raw = process.env.BROADCAST_RATE_WINDOW_MS ?? process.env.AUTO_BROADCAST_WINDOW_MS;
    const val =
        raw != null && String(raw).trim() !== ''
            ? clampInt(raw, DEFAULT_RATE_WINDOW_MS)
            : DEFAULT_RATE_WINDOW_MS;
    return Math.min(48 * HOUR, Math.max(HOUR, val));
}

function resolveMaxPerDestination() {
    const raw = process.env.BROADCAST_MAX_PER_DESTINATION ?? process.env.AUTO_BROADCAST_MAX_PER_12H;
    const val =
        raw != null && String(raw).trim() !== ''
            ? clampInt(raw, DEFAULT_MAX_PER_DESTINATION)
            : DEFAULT_MAX_PER_DESTINATION;
    return Math.min(10, Math.max(1, val));
}

function isPvBroadcastQueueEnabled() {
    const flag = String(process.env.BROADCAST_PV_USE_QUEUE || '').trim().toLowerCase();
    return flag === '1' || flag === 'true' || flag === 'yes';
}

/** Jobs PV mais velhos que isso são descartados (órfãos de ciclo anterior). */
function resolvePvMaxJobAgeMs() {
    const raw = process.env.BROADCAST_PV_MAX_JOB_AGE_MS;
    const fallback = 6 * HOUR;
    if (raw == null || String(raw).trim() === '') return fallback;
    return Math.max(0, clampInt(raw, fallback));
}

/**
 * Intervalo mínimo entre ciclos completos de divulgação (PV + grupos).
 * Padrão: 24h — no máximo 1 rodada PV por dia.
 */
function resolvePvCycleGuardMs() {
    const raw =
        process.env.AUTO_BROADCAST_PV_CYCLE_MS ??
        process.env.BROADCAST_PV_CYCLE_MS ??
        process.env.BROADCAST_RATE_WINDOW_MS ??
        process.env.AUTO_BROADCAST_WINDOW_MS;
    const val =
        raw != null && String(raw).trim() !== ''
            ? clampInt(raw, DEFAULT_RATE_WINDOW_MS)
            : DEFAULT_RATE_WINDOW_MS;
    return Math.min(48 * HOUR, Math.max(HOUR, val));
}

/** Ciclo efetivo = max(intervalo .env, guarda PV 12h). */
function resolveEffectiveAutoBroadcastIntervalMs() {
    return Math.max(resolveIntervalMs(), resolvePvCycleGuardMs());
}

/** Ex.: "2h", "1h 30min", "90 min" */
function formatBroadcastInterval(ms) {
    const totalMin = Math.round(ms / 60000);
    if (totalMin < 60) return `${totalMin} min`;
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (!m) return `${h}h`;
    return `${h}h ${m}min`;
}

function isPvOnceDaily() {
    const flag = String(process.env.BROADCAST_PV_ONCE_DAILY || '').trim().toLowerCase();
    if (flag === '0' || flag === 'false' || flag === 'no') return false;
    if (flag === '1' || flag === 'true' || flag === 'yes') return true;
    return resolveMaxPerDestination() <= 1 && resolveRateWindowMs() >= 24 * HOUR;
}

module.exports = {
    AUTO_BROADCAST_INTERVAL_MS: resolveIntervalMs(),
    AUTO_BROADCAST_EFFECTIVE_INTERVAL_MS: resolveEffectiveAutoBroadcastIntervalMs(),
    AUTO_BROADCAST_DELAYS: resolveAutoDelays(),
    BROADCAST_RATE_WINDOW_MS: resolveRateWindowMs(),
    BROADCAST_MAX_PER_DESTINATION: resolveMaxPerDestination(),
    formatBroadcastInterval,
    isPvBroadcastQueueEnabled,
    resolvePvJitterRatio,
    resolvePvMinGapMs,
    resolveMaxUsersPerCycle,
    resolvePvUserDelayMs,
    resolvePvMaxJobAgeMs,
    resolvePvCycleGuardMs,
    resolveEffectiveAutoBroadcastIntervalMs,
    isPvOnceDaily,
    PV_USER_DELAY_MIN_MS,
    PV_USER_DELAY_DEFAULT_MS,
    BROADCAST_INTERVAL_MIN_MS: MIN_MS,
    BROADCAST_INTERVAL_DEFAULT_MS: DEFAULT_INTERVAL_MS,
    BROADCAST_RATE_WINDOW_DEFAULT_MS: DEFAULT_RATE_WINDOW_MS,
};
