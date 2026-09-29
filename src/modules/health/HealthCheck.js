/**
 * Module: Health Check
 * Endpoints de monitoramento e readiness probe
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const CacheService = require('../cache/CacheService');
const SessionStore = require('../session/SessionStore');
const QueueService = require('../queue/QueueService');
const { formatPrometheus } = require('./prometheusFormat');
const { countStuckOrders } = require('./orderMetrics');

const BULL_QUEUE_NAMES = [
    'broadcast:telegram',
    'broadcast:pv',
    'broadcast:email',
    'delivery:products',
    'delivery:resend',
    'notification:abandoned',
    'notification:pix',
    'report:daily',
    'ai:catalog',
    'wadv:campaign',
    'smm:fulfill',
    'virtuo:fulfill',
];

class HealthCheck {
  /**
   * Status geral do sistema
   * @param {{ fast?: boolean }} opts — fast: timeouts curtos para dashboard ops
   */
  async getStatus(opts = {}) {
    const fast = opts.fast === true;
    const status = {
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: this._getMemoryUsage(),
      cpu: this._getCPUUsage(),
      services: await this._checkServices(fast)
    };

    const allHealthy = Object.values(status.services).every(s => s.healthy);
    status.healthy = allHealthy;

    return status;
  }

  _raceCheck(promise, ms, fallback) {
    return Promise.race([
      Promise.resolve(promise),
      new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
    ]);
  }

  /**
   * Verificação individual dos serviços (paralelo)
   */
  async _checkServices(fast = false) {
    const sessionMs = fast ? 400 : 2000;
    const queueMs = fast ? 500 : 3000;

    const [database, cache, session, queue] = await Promise.all([
      this._raceCheck(this._checkDatabase(), fast ? 800 : 5000, { healthy: false, error: 'timeout' }),
      this._raceCheck(this._checkCache(), fast ? 400 : 3000, { healthy: true, type: 'unknown', skipped: true }),
      this._raceCheck(this._checkSession(), sessionMs, { healthy: true, activeSessions: 0, skipped: true }),
      this._raceCheck(this._checkQueue(), queueMs, { healthy: true, waiting: 0, active: 0, skipped: true }),
    ]);

    return { database, cache, session, queue };
  }

  async _checkDatabase() {
    try {
      const { prisma } = require('../../config/database-sqlite');
      await prisma.$queryRaw`SELECT 1`;
      return { healthy: true, type: 'sqlite' };
    } catch (e) {
      return { healthy: false, error: e.message };
    }
  }

  async _checkCache() {
    try {
      const cacheStats = await CacheService.stats();
      return {
        healthy: true,
        type: cacheStats.type,
        ...(cacheStats.size && { size: cacheStats.size })
      };
    } catch (e) {
      return { healthy: false, error: e.message };
    }
  }

  async _checkSession() {
    try {
      const activeSessions = await SessionStore.listActive();
      return { healthy: true, activeSessions };
    } catch (e) {
      return { healthy: false, error: e.message };
    }
  }

  async _checkQueue() {
    try {
      const queueStatus = await QueueService.getStatus('broadcast:telegram');
      return {
        healthy: true,
        waiting: queueStatus?.waiting || 0,
        active: queueStatus?.active || 0
      };
    } catch (e) {
      return { healthy: false, error: e.message };
    }
  }

  _getMemoryUsage() {
    const used = process.memoryUsage();
    return {
      rss: this._formatBytes(used.rss),
      heapTotal: this._formatBytes(used.heapTotal),
      heapUsed: this._formatBytes(used.heapUsed),
      external: this._formatBytes(used.external)
    };
  }

  _getCPUUsage() {
    const loadAvg = os.loadavg();
    return {
      loadAverage: loadAvg.map(l => l.toFixed(2)),
      cpus: os.cpus().length
    };
  }

  _formatBytes(bytes) {
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 Bytes';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  }

  /**
   * Verificação rápida (para load balancers)
   */
  async isHealthy() {
    try {
      const status = await this.getStatus();
      return status.healthy;
    } catch (e) {
      return false;
    }
  }

  _waIpcConnected() {
    if (String(process.env.ZERO_DIVU_ENABLED || '').toLowerCase() !== 'true' &&
        !['1', 'yes', 'on'].includes(String(process.env.ZERO_DIVU_ENABLED || '').toLowerCase())) {
      return null;
    }
    try {
      const ipcDir = process.env.ZERO_DIVU_IPC_DIR || path.join(process.cwd(), 'shared', 'zero-ipc');
      const statePath = path.join(ipcDir, 'state.json');
      if (!fs.existsSync(statePath)) return 0;
      const st = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      return st?.connected || st?.waConnected ? 1 : 0;
    } catch {
      return 0;
    }
  }

  /**
   * Métricas flat (legado / compat)
   */
  async getMetrics() {
    const entries = await this._collectMetricEntries();
    const flat = {};
    for (const e of entries) {
      const key = e.labels
        ? `${e.name}_${Object.values(e.labels).join('_')}`.replace(/[^a-z0-9_]/gi, '_')
        : e.name;
      flat[key] = e.value;
    }
    return flat;
  }

  /**
   * Texto Prometheus para GET /metrics (SP-4)
   */
  async getPrometheusText() {
    const entries = await this._collectMetricEntries();
    return formatPrometheus(entries);
  }

  async _collectMetricEntries() {
    const status = await this.getStatus();
    const mem = process.memoryUsage();
    const entries = [];

    const push = (name, value, opts = {}) => {
      entries.push({ name, value: Number(value) || 0, ...opts });
    };

    push('hanork_bot_uptime_seconds', status.uptime, {
      type: 'gauge',
      help: 'Process uptime in seconds',
    });
    push('hanork_bot_memory_heap_used_bytes', mem.heapUsed, {
      type: 'gauge',
      help: 'Node.js heap used bytes',
    });
    push('hanork_bot_memory_rss_bytes', mem.rss, { type: 'gauge' });
    push('hanork_database_healthy', status.services.database?.healthy ? 1 : 0, { type: 'gauge' });
    push('hanork_cache_healthy', status.services.cache?.healthy ? 1 : 0, { type: 'gauge' });
    push('hanork_session_active', status.services.session?.activeSessions || 0, { type: 'gauge' });

    const cacheType = status.services.cache?.type || 'unknown';
    push('hanork_redis_connected', cacheType === 'redis' ? 1 : 0, {
      type: 'gauge',
      help: '1 if Redis cache backend is active',
    });

    try {
      push('hanork_sqlite_busy_total', require('../../utils/sqliteRetry').getSqliteBusyStats().busyTotal, {
        type: 'counter',
        help: 'SQLite BUSY retry count',
      });
    } catch { /* ignore */ }

    try {
      const db = require('../../config/database-sqlite').connect();
      const stuck = countStuckOrders(db);
      push('hanork_stuck_paid_orders', stuck.stuckPaid, {
        type: 'gauge',
        help: `Orders PAID without delivery > ${stuck.stuckMinutes}min`,
      });
      push('hanork_stuck_delivering_orders', stuck.stuckDelivering, {
        type: 'gauge',
        help: `Orders DELIVERING > ${stuck.stuckMinutes}min`,
      });
      push('hanork_orders_waiting_payment', stuck.waitingPayment, { type: 'gauge' });
      push('hanork_orders_paid_pending_delivery', stuck.pendingDelivery, { type: 'gauge' });
    } catch { /* ignore */ }

    try {
      const { registry } = require('../../core/CallbackRegistry');
      const cs = registry.getStats();
      push('hanork_callback_dispatched_total', cs.dispatched, { type: 'counter' });
      push('hanork_callback_unknown_total', cs.unknown, { type: 'counter' });
      push('hanork_callback_errors_total', cs.errors, { type: 'counter' });
    } catch { /* ignore */ }

    try {
      const gw = require('../../core/hanorkGateway').getStats();
      push('hanork_gateway_registry_total', gw.registry, { type: 'counter' });
      push('hanork_gateway_legacy_total', gw.legacyTotal, { type: 'counter' });
      push('hanork_gateway_mismatch_total', gw.mismatch, { type: 'counter' });
    } catch { /* ignore */ }

    try {
      const GptQueue = require('../../services/GptRequestQueue');
      const gs = GptQueue.getStats();
      const m = gs.metrics || {};
      push('hanork_ai_requests_total', m.requests || 0, { type: 'counter' });
      push('hanork_ai_success_total', m.success || 0, { type: 'counter' });
      push('hanork_ai_fail_total', m.fail || 0, { type: 'counter' });
      push('hanork_ai_429_total', m.rateLimited || 0, { type: 'counter' });
      push('hanork_ai_cache_hit_total', m.cacheHit || 0, { type: 'counter' });
      push('hanork_ai_queue_depth', gs.queue || 0, { type: 'gauge' });
      push('hanork_ai_active_requests', gs.active || 0, { type: 'gauge' });
      push('hanork_ai_latency_avg_ms', m.avgMs || 0, { type: 'gauge' });
      push('hanork_ai_rate_limited', gs.rateLimited ? 1 : 0, { type: 'gauge' });
    } catch { /* ignore */ }

    try {
      const { getPollingMetrics } = require('../../telegram/pollingRecovery');
      const pm = getPollingMetrics();
      push('hanork_bot_polling_active', pm.pollingActive, { type: 'gauge' });
      push('hanork_409_conflicts_total', pm.conflicts409Total, { type: 'counter' });
    } catch { /* ignore */ }

    try {
      const dedup = require('../payment/webhookPaymentDedup');
      push('hanork_webhook_dedup_memory_total', dedup.dedupMetrics?.memory || 0, { type: 'counter' });
      push('hanork_webhook_dedup_redis_total', dedup.dedupMetrics?.redis || 0, { type: 'counter' });
    } catch { /* ignore */ }

    const wa = this._waIpcConnected();
    if (wa != null) {
      push('hanork_wa_ipc_connected', wa, { type: 'gauge', help: 'WhatsApp worker IPC connected' });
    }

    try {
      const bootMetrics = require('./bootMetrics');
      const boot = bootMetrics.getBootSnapshot();
      push('hanork_boot_complete', boot.bootComplete, { type: 'gauge', help: '1 when bot launch finished' });
      push('hanork_boot_in_progress', boot.bootInProgress, { type: 'gauge' });
      push('hanork_boot_duration_seconds', boot.bootDurationSeconds, {
        type: 'gauge',
        help: 'Seconds from startBot entry to Telegram launch',
      });
      const smm = bootMetrics.getSmmSyncSnapshot();
      if (smm.ageSeconds != null) {
        push('hanork_smm_sync_age_seconds', smm.ageSeconds, {
          type: 'gauge',
          help: 'Seconds since last successful SMM catalog sync',
        });
        push('hanork_smm_sync_last_processed', smm.lastProcessed, { type: 'gauge' });
      }
    } catch { /* ignore */ }

    try {
      const { getOpsMetricsSnapshot } = require('../wa-divulgacao/waDivulgacaoOpsMetrics');
      const wadv = getOpsMetricsSnapshot();
      const wc = wadv.counters || {};
      push('wadv_workers_active', wc.wadv_workers_active || 0, { type: 'gauge', help: 'Hanork Div subscriber workers alive' });
      push('wadv_workers_connected', wc.wadv_workers_connected || 0, { type: 'gauge', help: 'Hanork Div WA sessions connected' });
      push('wadv_subscribers_active', wc.wadv_subscribers_active || 0, { type: 'gauge' });
      push('wadv_worker_restarts', wc.wadv_worker_restarts || 0, { type: 'counter' });
      push('wadv_ipc_timeouts', wc.wadv_ipc_timeouts || 0, { type: 'counter' });
      push('wadv_reconnect_ok', wc.wadv_reconnect_ok || 0, { type: 'counter' });
      push('wadv_offline_alerts', wc.wadv_offline_alerts || 0, { type: 'counter' });
    } catch { /* ignore */ }

    for (const qName of BULL_QUEUE_NAMES) {
      try {
        const qs = await QueueService.getStatus(qName);
        if (!qs) continue;
        push('hanork_bull_queue_waiting', qs.waiting || 0, { labels: { queue: qName }, type: 'gauge' });
        push('hanork_bull_queue_active', qs.active || 0, { labels: { queue: qName }, type: 'gauge' });
        push('hanork_bull_queue_failed', qs.failed || 0, { labels: { queue: qName }, type: 'gauge' });
      } catch { /* ignore */ }
    }

    // Compat aliases (nomes antigos)
    push('bot_uptime_seconds', status.uptime, { type: 'gauge' });
    push('bot_memory_heap_used_bytes', mem.heapUsed, { type: 'gauge' });
    push('bot_database_healthy', status.services.database?.healthy ? 1 : 0, { type: 'gauge' });
    push('bot_queue_waiting', status.services.queue?.waiting || 0, { type: 'gauge' });
    push('bot_queue_active', status.services.queue?.active || 0, { type: 'gauge' });

    return entries;
  }
}

module.exports = new HealthCheck();
