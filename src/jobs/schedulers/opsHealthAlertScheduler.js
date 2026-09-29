'use strict';

/**
 * Fase 0 leve — alertas periódicos no log ([OPS:ALERT]).
 * Sem Grafana; dedup para não spammar terminal.log.
 */

const logger = require('../../config/logger');
const { getSqliteBusyStats } = require('../../utils/sqliteRetry');
const { logSchedulerOn } = require('./cronBootLog');

const DEFAULT_INTERVAL_MS = Math.max(
    60000,
    Number(process.env.OPS_HEALTH_ALERT_INTERVAL_MS) || 5 * 60 * 1000
);
const DEDUP_MS = Math.max(60000, Number(process.env.OPS_HEALTH_ALERT_DEDUP_MS) || 10 * 60 * 1000);

const QUEUE_NAMES = [
    'delivery:products',
    'delivery:resend',
    'broadcast:telegram',
    'broadcast:pv',
    'notification:admin',
    'notification:pix',
    'ai:catalog',
];

let _lastBusyTotal = 0;
const _alertAt = new Map();

function isEnabled() {
    const v = process.env.OPS_HEALTH_ALERTS_ENABLED;
    if (v === '0' || v === 'false') return false;
    return v === '1' || v === 'true' || v === undefined || v === '';
}

function shouldAlert(key) {
    const now = Date.now();
    const last = _alertAt.get(key) || 0;
    if (now - last < DEDUP_MS) return false;
    _alertAt.set(key, now);
    return true;
}

function emitAlert(key, message, meta = {}) {
    if (!shouldAlert(key)) return;
    logger.warn(`[OPS:ALERT] ${message}`, meta);
}

async function runOpsHealthCheck(deps = {}) {
    const QueueService = deps.QueueService || require('../../modules/queue/QueueService');
    const queueDepthWarn = Math.max(5, Number(process.env.OPS_QUEUE_DEPTH_WARN) || 25);
    const sqliteBusyWarn = Math.max(1, Number(process.env.OPS_SQLITE_BUSY_WARN) || 8);

    const busy = getSqliteBusyStats();
    const busyDelta = busy.busyTotal - _lastBusyTotal;
    _lastBusyTotal = busy.busyTotal;
    if (busyDelta >= sqliteBusyWarn) {
        emitAlert('sqlite_busy', 'SQLite BUSY acima do limiar no intervalo', {
            delta: busyDelta,
            total: busy.busyTotal,
            threshold: sqliteBusyWarn,
        });
    }

    for (const name of QUEUE_NAMES) {
        try {
            const st = await QueueService.getStatus(name);
            if (!st) continue;
            const depth = (st.waiting || 0) + (st.active || 0);
            if (depth >= queueDepthWarn) {
                emitAlert(`queue:${name}`, `Fila Bull profunda: ${name}`, {
                    waiting: st.waiting,
                    active: st.active,
                    failed: st.failed,
                    threshold: queueDepthWarn,
                });
            }
            if ((st.failed || 0) >= 10) {
                emitAlert(`queue_failed:${name}`, `Fila com jobs falhos: ${name}`, {
                    failed: st.failed,
                });
            }
        } catch {
            /* fila pode não estar inicializada ainda */
        }
    }

    try {
        const { getRedisState } = require('../../modules/state');
        const rs = getRedisState();
        const stats = rs.getStats?.() || {};
        if (stats.useFallback && stats.failClosed) {
            emitAlert('redis_state_fallback', 'RedisState em fallback com fail-closed ativo', stats);
        }
    } catch {
        /* ignore */
    }

    try {
        const GptQueue = require('../../services/GptRequestQueue');
        const ai = GptQueue.getStats();
        if (ai.rateLimited) {
            emitAlert('ai_rate_limit', 'ZeroTwo AI em cooldown (rate limit)', {
                queue: ai.queue,
                waPending: ai.waPending,
            });
        }
    } catch {
        /* ignore */
    }
}

function startOpsHealthAlertScheduler(deps = {}) {
    if (!isEnabled()) {
        deps.log?.info?.('[CRON] Ops health alerts OFF (OPS_HEALTH_ALERTS_ENABLED=0)');
        return null;
    }

    const log = deps.log || logger;
    const intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS;

    logSchedulerOn(log, '[CRON] Ops health alert scheduler ON', { intervalMs });

    setTimeout(() => runOpsHealthCheck(deps).catch(() => {}), 45000);

    return setInterval(() => {
        runOpsHealthCheck(deps).catch((e) => {
            log.error('[OPS:ALERT] check failed:', e.message);
        });
    }, intervalMs);
}

module.exports = {
    runOpsHealthCheck,
    startOpsHealthAlertScheduler,
    DEFAULT_INTERVAL_MS,
};
