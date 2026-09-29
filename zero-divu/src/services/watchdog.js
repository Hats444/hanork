'use strict';

const cycleLock = require('../utils/cycleLock');
const processHeartbeat = require('./processHeartbeat');
const runtimeSnapshot = require('./runtimeSnapshot');
const metrics = require('./metrics');
const { warningLog } = require('../utils/logger');

let timer = null;
let configuredInterval = 90000;
let lastCheck = Date.now();

exports.start = (intervalMs = 90000) => {
  configuredInterval = intervalMs;
  if (timer) return;
  lastCheck = Date.now();
  timer = setInterval(() => exports.check(), intervalMs);
  if (timer.unref) timer.unref();
};

exports.stop = () => {
  if (timer) clearInterval(timer);
  timer = null;
};

exports.check = () => {
  const now = Date.now();
  const gap = now - lastCheck;
  lastCheck = now;

  if (gap > configuredInterval * 3) {
    warningLog(`Watchdog: possível suspensão (${Math.round(gap / 1000)}s) — recalculando timers`);
    runtimeSnapshot.save({ suspended: true, gapMs: gap });
    try {
      require('./timerRegistry').syncFromScheduler();
    } catch {
      /* ignore */
    }
  }

  if (cycleLock.isBusy() && cycleLock.busyForMs() > 20 * 60 * 1000) {
    warningLog('Watchdog: cycleLock preso — reset');
    cycleLock.forceReset('watchdog');
    metrics.inc('retries');
  }

  processHeartbeat.tick({ watchdog: true });
};

module.exports = exports;
