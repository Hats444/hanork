'use strict';

let sock = null;
let connectionPaused = false;
let warmupUntil = 0;
let lastUnstableAt = 0;

exports.register = (s, opts = {}) => {
  sock = s;
  connectionPaused = false;
  if (opts.warmupMs > 0) {
    exports.setWarmup(opts.warmupMs);
  } else {
    exports.clearWarmup();
  }
};

exports.get = () => sock;

exports.setPaused = (v) => {
  connectionPaused = Boolean(v);
};

exports.setWarmup = (ms) => {
  warmupUntil = ms > 0 ? Date.now() + ms : 0;
};

exports.clearWarmup = () => {
  warmupUntil = 0;
};

exports.markUnstable = () => {
  lastUnstableAt = Date.now();
};

exports.isRecentlyUnstable = (windowMs = 90000) =>
  lastUnstableAt > 0 && Date.now() - lastUnstableAt < windowMs;

exports.isWarmingUp = () => warmupUntil > Date.now();

exports.warmupRemainingMs = () =>
  warmupUntil > Date.now() ? warmupUntil - Date.now() : 0;

exports.isOnline = (s) => {
  const active = s || sock;
  if (connectionPaused || exports.isWarmingUp()) return false;
  return Boolean(active?.user?.id);
};

exports.close = async (opts = {}) => {
  if (!sock) return;
  const s = sock;
  const waitMs = opts.waitMs ?? 500;
  sock = null;
  connectionPaused = true;
  warmupUntil = 0;

  try {
    if (opts.hard && typeof s.ws?.terminate === 'function') {
      s.ws.terminate();
    } else if (typeof s.end === 'function') {
      s.end(undefined);
    } else if (typeof s.ws?.close === 'function') {
      s.ws.close();
    }
  } catch {
    /* ignore */
  }

  await new Promise((r) => setTimeout(r, waitMs));
};

module.exports = exports;
