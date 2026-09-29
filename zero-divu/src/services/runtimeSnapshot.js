'use strict';

const store = require('../utils/debouncedStore');
const pathResolver = require('../utils/pathResolver');
const { writeJsonAtomic } = require('../utils/atomicWrite');

const FILE = 'runtimeSnapshot.json';

function collect() {
  let schedulerState = {};
  let antiBanState = {};
  let warmupState = {};
  let metrics = {};
  let pendingJoins = [];
  let pendingPosts = [];
  let retryTimers = {};
  let processHealth = null;
  let deliveryHistory = [];
  let memoryState = {};

  try {
    schedulerState = require('./groupScheduler').loadState();
  } catch {
    /* ignore */
  }
  try {
    antiBanState = store.load('antiBanState.json', {});
  } catch {
    /* ignore */
  }
  try {
    warmupState = store.load('warmupState.json', {});
  } catch {
    /* ignore */
  }
  try {
    metrics = require('./metrics').snapshot();
  } catch {
    /* ignore */
  }
  try {
    pendingJoins = require('./pendingInvites').list();
  } catch {
    /* ignore */
  }
  try {
    pendingPosts = require('./persistentQueue')
      .list('delivery')
      .filter((j) => j.status === 'pending' || j.status === 'processing' || j.status === 'retry');
  } catch {
    /* ignore */
  }
  try {
    retryTimers = require('./timerRegistry').load().timers || {};
  } catch {
    /* ignore */
  }
  try {
    processHealth = require('./processHeartbeat').load();
  } catch {
    /* ignore */
  }
  try {
    deliveryHistory = (store.load('deliveryDedup.json', {}).deliveries || []).slice(-30);
  } catch {
    /* ignore */
  }
  let rotationState = {};
  let groupReputation = {};
  let patternGuardState = {};
  try {
    rotationState = store.load('rotationState.json', {});
  } catch {
    /* ignore */
  }
  try {
    groupReputation = store.load('groupReputation.json', {});
  } catch {
    /* ignore */
  }
  try {
    patternGuardState = store.load('patternGuardState.json', {});
  } catch {
    /* ignore */
  }
  try {
    const mu = process.memoryUsage();
    memoryState = {
      heapUsedMb: Math.round(mu.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(mu.heapTotal / 1024 / 1024),
      rssMb: Math.round(mu.rss / 1024 / 1024),
      uptimeSec: Math.round(process.uptime()),
    };
  } catch {
    /* ignore */
  }

  let currentCycleState = { busy: false };
  try {
    const cycleLock = require('../utils/cycleLock');
    currentCycleState = {
      busy: cycleLock.isBusy(),
      owner: cycleLock.getOwner(),
      busyForMs: cycleLock.busyForMs(),
    };
  } catch {
    /* ignore */
  }

  return {
    at: new Date().toISOString(),
    pid: process.pid,
    schedulerState,
    antiBanState,
    warmupState,
    metrics,
    activeQueues: (() => {
      try {
        return require('./queueManager').counts();
      } catch {
        return {
          delivery: require('./persistentQueue').count('delivery'),
          join: require('./persistentQueue').count('join'),
          retry: require('./persistentQueue').count('retry'),
          maintenance: require('./persistentQueue').count('maintenance'),
          cooldown: require('./persistentQueue').count('cooldown'),
        };
      }
    })(),
    pendingJoins,
    pendingPosts,
    retryTimers,
    processHealth,
    deliveryHistory,
    rotationState,
    groupReputation,
    patternGuardState,
    memoryState,
    currentCycleState,
    locks: require('./persistentLocks').listActive(),
    recoveryMode: store.load('recoveryMode.json', { active: false }),
  };
}

exports.save = (extra = {}) => {
  const snap = { ...collect(), ...extra };
  store.setCritical(FILE, snap);
  if (!store.usingSql?.()) {
    try {
      writeJsonAtomic(pathResolver.runtimeFile('runtimeSnapshot.json'), snap);
    } catch {
      /* ignore */
    }
  }
  return snap;
};

exports.load = () => store.load(FILE, null);

exports.savePeriodic = (() => {
  let timer = null;
  return (intervalMs = 120000) => {
    if (timer) return;
    timer = setInterval(() => exports.save({ periodic: true }), intervalMs);
    if (timer.unref) timer.unref();
  };
})();

exports.stopPeriodic = () => {
  /* timer kept simple — cleared on shutdown via flush */
};

module.exports = exports;
