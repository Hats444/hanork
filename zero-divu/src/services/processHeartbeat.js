'use strict';

const cfg = require('../config/divulgacao');
const store = require('../utils/debouncedStore');
const pathResolver = require('../utils/pathResolver');
const { writeJsonAtomic } = require('../utils/atomicWrite');

const FILE = 'processHeartbeat.json';
const STALE_MS = 3 * 60 * 1000;

let timer = null;
let configuredInterval = 30000;

exports.tick = (extra = {}) => {
  let queues = {};
  let schedulerDue = 0;
  try {
    queues = require('./queueManager').counts();
  } catch {
    /* ignore */
  }
  try {
    schedulerDue = require('./timerRegistry').getDue().length;
  } catch {
    /* ignore */
  }

  const beat = {
    at: new Date().toISOString(),
    pid: process.pid,
    heapMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    uptimeSec: Math.round(process.uptime()),
    cleanExit: false,
    queues,
    schedulerDue,
    ...extra,
  };
  store.setCritical(FILE, beat);
  if (!store.usingSql?.()) {
    try {
      writeJsonAtomic(pathResolver.runtimeFile('heartbeat.json'), beat);
    } catch {
      /* ignore */
    }
  }
  return beat;
};

exports.start = (intervalMs = 30000, opts = {}) => {
  configuredInterval = intervalMs;
  if (timer) return;
  exports.tick({ started: true, ...(opts.extra || {}) });
  timer = setInterval(() => exports.tick(), intervalMs);
  if (!opts.keepAlive && timer.unref) timer.unref();
};

exports.stop = () => {
  if (timer) clearInterval(timer);
  timer = null;
};

exports.markCleanExit = () => {
  exports.tick({ cleanExit: true, stopping: true });
};

exports.getIntervalMs = () => configuredInterval;

exports.wasCrash = () => {
  const prev = store.load(FILE, null);
  if (!prev?.at) return false;
  if (prev.cleanExit) return false;
  if (prev.reconnectPending) return false;

  try {
    const shutdown = require('./checkpoints').getLast('before_shutdown');
    if (shutdown?.at) {
      const age = Date.now() - new Date(shutdown.at).getTime();
      if (age < 5 * 60 * 1000) return false;
    }
    const reconnect = require('./checkpoints').getLast('before_reconnect');
    if (reconnect?.at) {
      const age = Date.now() - new Date(reconnect.at).getTime();
      if (age < 3 * 60 * 1000) return false;
    }
  } catch {
    /* ignore */
  }

  const age = Date.now() - new Date(prev.at).getTime();
  return age < STALE_MS && prev.pid !== process.pid;
};

exports.load = () => store.load(FILE, null);

module.exports = exports;
