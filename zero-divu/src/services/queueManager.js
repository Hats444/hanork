'use strict';

const cfg = require('../config/divulgacao');
const { QueueWorker } = require('./queueWorker');
const persistentQueue = require('./persistentQueue');
const { infoLog } = require('../utils/logger');
const bootQuiet = require('../utils/bootQuiet');

const maintenanceWorker = new QueueWorker('maintenance', { concurrency: 1, intervalMs: 5000 });
const cooldownWorker = new QueueWorker('cooldown', { concurrency: 1, payloadKey: 'jid', intervalMs: 8000 });
const retryWorker = new QueueWorker('retry', { concurrency: 1, payloadKey: 'key', intervalMs: 30000 });

let sockRef = null;
let maintenanceTimer = null;
let started = false;
let frozen = false;
let activeJobs = 0;

function reclaimAll() {
  for (const name of ['join', 'delivery', 'maintenance', 'cooldown', 'retry']) {
    const n = persistentQueue.reclaimProcessing(name);
    if (n > 0) bootQuiet.bootInfo(infoLog, `Fila ${name}: ${n} recuperado(s)`);
  }
}

exports.startAll = (sock) => {
  if (started) return;
  started = true;
  sockRef = sock;
  reclaimAll();

  maintenanceWorker.setProcessor(async () => {
    if (!sockRef) return;
    await require('./cleanup').run(sockRef);
    await require('./groupHealth').runMaintenance(sockRef);
    await require('./postWatchdog').kickIfStuck(sockRef);
  });
  maintenanceWorker.start();

  cooldownWorker.setProcessor(async (payload) => {
    if (!payload?.jid) return;
    require('./groupValidator').registerGroup(payload.jid, {
      healthPaused: false,
      cooldownUntil: null,
    });
  });
  cooldownWorker.start();

  retryWorker.setProcessor(async () => {
    let total = 0;
    for (const name of ['join', 'delivery', 'maintenance']) {
      total += persistentQueue.reviveDueRetries(name);
    }
    return total;
  });
  retryWorker.start();

  const interval = cfg.CLEANUP_INTERVAL_MS || 3600000;
  maintenanceTimer = setInterval(() => {
    if (maintenanceWorker.count() === 0) {
      maintenanceWorker.enqueue({ at: Date.now() }, 'maintenance-sweep');
    }
    retryWorker.enqueue({ at: Date.now(), key: `retry-${Date.now()}` }, 'retry-sweep');
  }, interval);
  if (maintenanceTimer.unref) maintenanceTimer.unref();

  const maintPending = persistentQueue.count('maintenance');
  if (maintPending === 0) {
    maintenanceWorker.enqueue({ at: Date.now(), boot: true }, 'maintenance-sweep');
  } else {
    persistentQueue.collapseDuplicateJobs?.('maintenance', 'maintenance-sweep');
  }

  try {
    require('./postagem').startWorkers(sock);
  } catch {
    /* ignore */
  }
};

exports.stopAll = () => {
  started = false;
  frozen = false;
  sockRef = null;
  if (maintenanceTimer) clearInterval(maintenanceTimer);
  maintenanceTimer = null;
  maintenanceWorker.stop();
  cooldownWorker.stop();
  retryWorker.stop();
};

exports.enqueueCooldown = (jid, untilMs, reason = '') => {
  cooldownWorker.enqueue({ jid, untilMs, reason }, 'cooldown');
};

exports.scheduleRetry = (sourceQueue, jobId) => {
  retryWorker.enqueue(
    { sourceQueue, jobId, key: `${sourceQueue}-${jobId}` },
    'retry-notify'
  );
};

exports.unfreeze = () => {
  frozen = false;
};

exports.isFrozen = () => frozen;

exports.freeze = () => {
  frozen = true;
};

exports.waitForDrain = async (timeoutMs = 12000) => {
  const deadline = Date.now() + timeoutMs;
  while (activeJobs > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
  }
  return activeJobs === 0;
};

exports.trackJobStart = () => {
  activeJobs++;
};

exports.trackJobEnd = () => {
  activeJobs = Math.max(0, activeJobs - 1);
};

exports.getActiveJobs = () => activeJobs;

exports.counts = () => ({
  maintenance: persistentQueue.count('maintenance'),
  cooldown: persistentQueue.count('cooldown'),
  retry: persistentQueue.count('retry'),
  join: persistentQueue.count('join'),
  delivery: persistentQueue.count('delivery'),
});

exports.reclaimAll = reclaimAll;

module.exports = exports;
