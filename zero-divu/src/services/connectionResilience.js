'use strict';

const cfg = require('../config/divulgacao');

let conflict440Streak = 0;
let conflictPausedUntil = 0;
let lastDisconnectAt = 0;
let last440At = 0;
let lastStatusCode = null;
let reconnectAttempts = 0;
let connecting = false;
let stableTimer = null;
let ghostWaitDone = false;

exports.isConnecting = () => connecting;
exports.setConnecting = (v) => {
  connecting = v;
};

exports.getConflict440Streak = () => conflict440Streak;
exports.getLast440At = () => last440At;

exports.hadRecent440 = (withinMs = cfg.RECONNECT_440_QUIET_MS ?? 90000) =>
  last440At > 0 && Date.now() - last440At < withinMs;

exports.recordDisconnect = (statusCode) => {
  lastDisconnectAt = Date.now();
  lastStatusCode = statusCode || null;
  reconnectAttempts++;

  if (stableTimer) {
    clearTimeout(stableTimer);
    stableTimer = null;
  }
  ghostWaitDone = false;

  if (statusCode === 440) {
    last440At = Date.now();
    conflict440Streak = Math.min(conflict440Streak + 1, 20);
    const pauseAfter = cfg.RECONNECT_CONFLICT_PAUSE_AFTER ?? 5;
    const pauseMs = cfg.RECONNECT_CONFLICT_PAUSE_MS ?? 5 * 60 * 1000;
    if (conflict440Streak >= pauseAfter) {
      conflictPausedUntil = Date.now() + pauseMs;
    }
  } else if (statusCode !== 401 && statusCode !== undefined) {
    conflict440Streak = Math.max(0, conflict440Streak - 1);
  }
};

exports.markGhostWaitDone = () => {
  ghostWaitDone = true;
};

exports.recordConnectSuccess = () => {
  reconnectAttempts = 0;
  lastStatusCode = null;

  if (stableTimer) clearTimeout(stableTimer);
  const stableMs = cfg.RECONNECT_440_STABLE_MS ?? 120000;
  stableTimer = setTimeout(() => {
    conflict440Streak = 0;
    conflictPausedUntil = 0;
    stableTimer = null;
  }, stableMs);
  if (stableTimer.unref) stableTimer.unref();
};

exports.computeDelayMs = (statusCode) => {
  const minGap = cfg.RECONNECT_MIN_GAP_MS ?? 12000;
  const since = Date.now() - lastDisconnectAt;
  let delay = minGap;

  if (statusCode === 440) {
    if (ghostWaitDone) {
      return Math.max(minGap, cfg.RECONNECT_440_DUPE_SETTLE_MS ?? 3000);
    }

    const min440 = cfg.RECONNECT_440_MIN_MS ?? 15000;
    const max440 = cfg.RECONNECT_440_MAX_MS ?? 45000;
    const streak = Math.max(conflict440Streak, 1);
    delay = Math.min(max440, min440 * Math.min(streak, 4));

    if (conflictPausedUntil > Date.now()) {
      delay = Math.max(delay, conflictPausedUntil - Date.now());
    }

    if (cfg.RECONNECT_440_AUTO_RESOLVE !== false) {
      delay = Math.max(delay, cfg.RECONNECT_440_GHOST_MS ?? 15000);
    }
  } else if (statusCode === 515) {
    delay = cfg.RECONNECT_515_MS ?? 15000;
  } else if (statusCode === 428) {
    const base = cfg.RECONNECT_RATE_LIMIT_MS ?? 120000;
    const max = cfg.RECONNECT_RATE_LIMIT_MAX_MS ?? 30 * 60 * 1000;
    const streak = Math.max(reconnectAttempts, 1);
    delay = Math.min(max, Math.round(base * Math.pow(1.45, Math.min(streak, 8))));
  } else {
    const base = cfg.RECONNECT_DEFAULT_MS ?? 10000;
    delay = Math.min(90000, base * Math.min(reconnectAttempts, 6));
  }

  if (since < minGap) {
    delay = Math.max(delay, minGap - since);
  }

  return Math.round(delay);
};

exports.isConflictPaused = () => conflictPausedUntil > Date.now();

exports.conflictPauseRemainingMs = () =>
  conflictPausedUntil > Date.now() ? conflictPausedUntil - Date.now() : 0;

exports.getStats = () => ({
  conflict440Streak,
  reconnectAttempts,
  lastStatusCode,
  last440At,
  conflictPaused: exports.isConflictPaused(),
});

module.exports = exports;
