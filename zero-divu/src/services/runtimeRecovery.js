'use strict';

const cfg = require('../config/divulgacao');
const store = require('../utils/debouncedStore');
const processHeartbeat = require('./processHeartbeat');
const runtimeSnapshot = require('./runtimeSnapshot');
const persistentQueue = require('./persistentQueue');
const timerRegistry = require('./timerRegistry');
const checkpoints = require('./checkpoints');
const { infoLog, warningLog } = require('../utils/logger');

const RESTORE_MAP = [
  { file: 'schedulerState.json', key: 'schedulerState' },
  { file: 'antiBanState.json', key: 'antiBanState' },
  { file: 'warmupState.json', key: 'warmupState' },
  { file: 'rotationState.json', key: 'rotationState' },
  { file: 'groupReputation.json', key: 'groupReputation' },
  { file: 'patternGuardState.json', key: 'patternGuardState' },
  { file: 'recoveryMode.json', key: 'recoveryMode' },
  { file: 'timerRegistry.json', key: 'retryTimers', transform: (v) => (v?.timers ? { timers: v.timers, version: 1 } : null) },
];

function isEmptyState(file, live) {
  if (live === null || live === undefined) return true;
  if (file === 'schedulerState.json') return Object.keys(live.groups || {}).length === 0;
  if (file.endsWith('.json') && typeof live === 'object') return Object.keys(live).length === 0;
  return false;
}

exports.run = async () => {
  const crashed = processHeartbeat.wasCrash();
  const isReconnect = require('./processRuntime').isReconnectBoot();
  const mode = store.load('recoveryMode.json', { active: false });
  const lastShutdown = checkpoints.getLast('before_shutdown');
  const lastReconnect = checkpoints.getLast('before_reconnect');
  const recentReconnect =
    lastReconnect?.at && Date.now() - new Date(lastReconnect.at).getTime() < 3 * 60 * 1000;

  if ((!crashed && !isReconnect && !recentReconnect) || (isReconnect && !crashed)) {
    if (mode.active) {
      store.setCritical('recoveryMode.json', {
        active: false,
        clearedAt: new Date().toISOString(),
        reason: isReconnect ? 'reconnect' : 'normal-boot',
      });
    }
  }

  const needRecoveryMode =
    crashed || (!isReconnect && !recentReconnect && mode.active && !lastShutdown?.at);

  if (needRecoveryMode) {
    warningLog('Recovery mode — retomada após interrupção inesperada');
    store.setCritical('recoveryMode.json', {
      active: true,
      reason: mode.reason || 'crash',
      recoveredAt: new Date().toISOString(),
      lastShutdown: lastShutdown?.at || null,
    });
  } else if (isReconnect || recentReconnect) {
    infoLog('Reconnect Baileys — estado preservado (sem recovery agressivo)');
  }

  try {
    require('./queueManager').reclaimAll();
  } catch {
    /* ignore */
  }

  for (const name of ['join', 'delivery', 'maintenance', 'cooldown', 'retry']) {
    persistentQueue.reviveDueRetries(name);
    if (isReconnect || recentReconnect) {
      persistentQueue.reclaimProcessing(name, 2 * 60 * 1000);
    }
  }

  timerRegistry.syncFromScheduler();
  const dueTimers = timerRegistry.getDue();
  if (dueTimers.length) {
    infoLog(`${dueTimers.length} timer(s) vencido(s) durante offline — scheduler retoma normalmente`);
  }
  timerRegistry.pruneExpired();

  const snap = runtimeSnapshot.load();
  const restored = exports.restoreFromSnapshot(snap, {
    force: crashed && !isReconnect && !recentReconnect,
    reconnect: isReconnect || recentReconnect,
  });
  if (restored.length) {
    const store = require('../utils/debouncedStore');
    const where = store.usingSql?.() ? 'SQLite (hanork.db)' : 'disco';
    const labels = restored.map((f) => String(f).replace(/\.json$/i, ''));
    infoLog(`Estado restaurado (${where}): ${labels.join(', ')}`);
    timerRegistry.syncFromScheduler();
  }

  return {
    recoveryMode: needRecoveryMode,
    snapshot: snap,
    dueTimers: dueTimers.length,
    restored,
  };
};

/** Replay unificado do snapshot operacional */
exports.restoreFromSnapshot = (snap, opts = {}) => {
  if (!snap?.at) return [];
  if (opts.reconnect) return [];

  const restored = [];
  const snapTime = new Date(snap.at).getTime();
  const force = Boolean(opts.force);

  for (const entry of RESTORE_MAP) {
    let payload = snap[entry.key];
    if (entry.transform) payload = entry.transform(payload);
    if (!payload || typeof payload !== 'object') continue;

    try {
      const live = store.load(entry.file, null);
      const liveEmpty = isEmptyState(entry.file, live);
      let liveTime = 0;
      try {
        const fs = require('fs');
        const p = require('../utils/debouncedStore').filePath(entry.file);
        if (fs.existsSync(p)) liveTime = fs.statSync(p).mtimeMs;
      } catch {
        /* ignore */
      }

      if (force || liveEmpty || snapTime > liveTime) {
        store.setCritical(entry.file, payload);
        restored.push(entry.file);
      }
    } catch {
      /* ignore */
    }
  }

  try {
    if (snap.metrics && require('./metrics').restore(snap.metrics)) {
      if (!restored.includes('metricsState.json')) restored.push('metricsState.json');
    }
  } catch {
    /* ignore */
  }

  return restored;
};

exports.clearRecoveryMode = () => {
  store.setCritical('recoveryMode.json', { active: false, clearedAt: new Date().toISOString() });
};

exports.isRecoveryActive = () => {
  const mode = store.load('recoveryMode.json', { active: false });
  return Boolean(mode.active);
};

exports.getRecoveryDelayFactor = () => {
  if (!exports.isRecoveryActive()) return 1;
  return cfg.RECOVERY_DELAY_FACTOR ?? 1.6;
};

exports.getRecoveryPostCap = () => {
  if (!exports.isRecoveryActive()) return null;
  return cfg.RECOVERY_MAX_GROUPS_PER_WAKE ?? 1;
};

module.exports = exports;
