'use strict';

const os = require('os');
const { connect: dbConnect } = require('../../config/database-sqlite');
const OpsMetricsStore = require('../../services/ops/OpsMetricsStore');
const { fetchWaBundle } = require('../../services/ops/HanorkOpsReportBuilder');
const HealthCheck = require('../health/HealthCheck');
const QueueService = require('../queue/QueueService');

const BULL_QUEUES = [
    'broadcast:telegram',
    'broadcast:email',
    'delivery:products',
    'delivery:resend',
    'notification:abandoned',
    'notification:pix',
    'notification:giveaway',
    'notification:subscription',
    'report:daily',
    'report:sales',
    'ai:catalog',
];

const WA_TIMEOUT_MS = 4500;
const HEALTH_TIMEOUT_MS = 1800;
const QUEUE_TIMEOUT_MS = 700;
const SUMMARY_CACHE_TTL_MS = 5000;

let _summaryCache = { data: null, ts: 0, inflight: null };

function clearOpsCache() {
    _summaryCache = { data: null, ts: 0, inflight: null };
}

function withTimeout(promise, ms, fallback) {
    return Promise.race([
        Promise.resolve(promise),
        new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
    ]);
}

function readKv(db, key) {
    try {
        return db.prepare('SELECT value FROM kv_store WHERE key=?').get(key)?.value ?? null;
    } catch {
        return null;
    }
}

function getGroupService(db) {
    try {
        const { GroupService } = require('../../services/GroupService');
        return new GroupService({ dbRaw: () => db });
    } catch {
        return null;
    }
}

function autoBroadcastBlock(db) {
    let summary = null;
    try {
        const raw = readKv(db, 'auto_broadcast:last_summary');
        summary = raw ? JSON.parse(raw) : null;
    } catch {
        summary = null;
    }
    return {
        enabled: readKv(db, 'auto_broadcast:enabled') !== '0',
        count: parseInt(readKv(db, 'auto_broadcast:count') || '0', 10),
        lastSent: parseInt(readKv(db, 'auto_broadcast:last_sent') || '0', 10),
        summary,
    };
}

function orderOps(db) {
    try {
        const { countStuckOrders } = require('../health/orderMetrics');
        return countStuckOrders(db);
    } catch {
        return {};
    }
}

function aiStats() {
    try {
        const GptQueue = require('../../services/GptRequestQueue');
        const gs = GptQueue.getStats();
        return { queue: gs.queue || 0, active: gs.active || 0, metrics: gs.metrics || {}, rateLimited: !!gs.rateLimited };
    } catch {
        return null;
    }
}

function pollingStats() {
    try {
        return require('../../telegram/pollingRecovery').getPollingMetrics();
    } catch {
        return null;
    }
}

function gatewayStats() {
    try {
        return require('../../core/hanorkGateway').getStats();
    } catch {
        return null;
    }
}

function callbackStats() {
    try {
        return require('../../core/CallbackRegistry').registry.getStats();
    } catch {
        return null;
    }
}

async function getQueueStatuses() {
    const out = await Promise.all(
        BULL_QUEUES.map(async (name) => {
            try {
                const s = await withTimeout(QueueService.getStatus(name), QUEUE_TIMEOUT_MS, null);
                if (s) return { name, ...s };
                return { name, waiting: 0, active: 0, failed: 0, offline: true };
            } catch {
                return { name, waiting: 0, active: 0, failed: 0, error: true };
            }
        })
    );
    return out;
}

async function buildOpsSummary() {
    const db = dbConnect();

    const [wa, health, queues] = await Promise.all([
        withTimeout(fetchWaBundle({ fast: true }), WA_TIMEOUT_MS, {
            enabled: false,
            error: 'timeout',
            online: false,
        }),
        withTimeout(HealthCheck.getStatus({ fast: true }), HEALTH_TIMEOUT_MS, {
            healthy: false,
            services: {},
            memory: {},
            timeout: true,
        }),
        getQueueStatuses(),
    ]);

    const gs = getGroupService(db);
    let tgGroups = {};
    try {
        tgGroups = gs?.getStats?.() || {};
    } catch {
        tgGroups = {};
    }

    const ab = autoBroadcastBlock(db);
    const counters = OpsMetricsStore.getCounters(db);
    const tgEvents = OpsMetricsStore.getRecent(db, 40);
    const waEvents = OpsMetricsStore.readWaOpsEvents(wa.ipcDir, 40);
    const stuck = orderOps(db);

    const countermeasures = [];
    for (const e of [...tgEvents, ...waEvents]) {
        if (e.countermeasure) {
            countermeasures.push({
                channel: e.channel || 'wa',
                at: e.ts,
                target: e.target,
                detail: e.detail,
                countermeasure: e.countermeasure,
            });
        }
        if (countermeasures.length >= 20) break;
    }

    const alerts = [];
    for (const e of tgEvents) {
        if (['fail', 'skip', 'retry'].includes(e.kind)) {
            alerts.push({ channel: 'tg', kind: e.kind, target: e.target, detail: e.detail, at: e.ts });
        }
        if (alerts.length >= 15) break;
    }
    for (const e of waEvents) {
        if (alerts.length >= 25) break;
        alerts.push({
            channel: 'wa',
            kind: e.kind || 'event',
            target: e.target,
            detail: e.detail,
            at: e.ts,
        });
    }

    let crm = null;
    try {
        const CRMService = require('../crm/CRMService');
        crm = CRMService.getSegmentStats({ mode: 'all', tenantId: null });
    } catch {
        /* optional */
    }

    let ticketsOpen = 0;
    try {
        ticketsOpen = db.prepare("SELECT COUNT(*) as c FROM support_tickets WHERE status='open'").get()?.c || 0;
    } catch {
        /* ignore */
    }

    const mem = process.memoryUsage();

    let wadv = null;
    try {
        const { getOpsMetricsSnapshot } = require('../wa-divulgacao/waDivulgacaoOpsMetrics');
        wadv = getOpsMetricsSnapshot();
    } catch {
        wadv = null;
    }

    return {
        generatedAt: new Date().toISOString(),
        host: {
            node: process.version,
            uptimeSec: Math.floor(process.uptime()),
            uptimeMin: Math.floor(process.uptime() / 60),
            ramMb: Math.round(mem.rss / 1024 / 1024),
            heapMb: Math.round(mem.heapUsed / 1024 / 1024),
            cpus: os.cpus().length,
            loadAvg: os.loadavg().map((n) => Number(n.toFixed(2))),
            platform: `${os.platform()} ${os.arch()}`,
        },
        health: {
            healthy: health.healthy,
            services: health.services,
            memory: health.memory,
            timeout: Boolean(health.timeout),
        },
        queues,
        orders: stuck,
        ticketsOpen,
        telegram: {
            groups: tgGroups,
            autoBroadcast: ab,
            opsCounters: Object.fromEntries(
                Object.entries(counters).filter(([k]) => k !== '_updatedAt')
            ),
        },
        whatsapp: wa,
        wadv,
        events: {
            tgRecent: tgEvents,
            waRecent: waEvents,
            countermeasures,
            alerts,
        },
        ai: aiStats(),
        polling: pollingStats(),
        gateway: gatewayStats(),
        callbacks: callbackStats(),
        crm,
        bot: {
            username: process.env.BOT_USERNAME || null,
            zeroDivuEnabled: (() => {
                try {
                    return require('../../plugins/zero-divu/config').isZeroDivuEnabled();
                } catch {
                    return false;
                }
            })(),
        },
    };
}

async function getFullOpsSummary(opts = {}) {
    const force = opts.force === true || opts.nocache === true;
    const now = Date.now();

    if (!force && _summaryCache.data && now - _summaryCache.ts < SUMMARY_CACHE_TTL_MS) {
        return _summaryCache.data;
    }

    if (_summaryCache.inflight && !force) {
        return _summaryCache.inflight;
    }

    const job = buildOpsSummary()
        .then((data) => {
            _summaryCache.data = data;
            _summaryCache.ts = Date.now();
            _summaryCache.inflight = null;
            return data;
        })
        .catch((e) => {
            _summaryCache.inflight = null;
            if (_summaryCache.data) return _summaryCache.data;
            throw e;
        });

    _summaryCache.inflight = job;
    return job;
}

module.exports = { getFullOpsSummary, getQueueStatuses, withTimeout, clearOpsCache };
