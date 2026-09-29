'use strict';

const os = require('os');
const env = require('./environmentDetector');

const PROFILES = {
  'low-memory': {
    jsonFlushMs: 6000,
    cacheTtlMs: 30000,
    monitorIntervalMs: 8 * 60 * 1000,
    compactCronometroMs: 90000,
  },
  balanced: {
    jsonFlushMs: 4000,
    cacheTtlMs: 60000,
    monitorIntervalMs: 5 * 60 * 1000,
    compactCronometroMs: 60000,
  },
  performance: {
    jsonFlushMs: 2500,
    cacheTtlMs: 120000,
    monitorIntervalMs: 3 * 60 * 1000,
    compactCronometroMs: 45000,
  },
};

function detectProfile() {
  const e = env.get();
  const memMb = os.totalmem() / 1024 / 1024;
  if (e.isTermux) return 'low-memory';
  if (memMb >= 8192) return 'performance';
  if (memMb < 4096) return 'low-memory';
  return 'balanced';
}

exports.getProfileName = () => detectProfile();

exports.get = () => PROFILES[detectProfile()] || PROFILES.balanced;

exports.applyToConfig = (cfg) => {
  const p = exports.get();
  return {
    ...cfg,
    JSON_FLUSH_MS: cfg.JSON_FLUSH_MS ?? p.jsonFlushMs,
    GROUP_SYNC_TTL_MS: cfg.GROUP_SYNC_TTL_MS ?? p.cacheTtlMs,
    MONITOR_INTERVAL_MS: cfg.MONITOR_INTERVAL_MS ?? p.monitorIntervalMs,
    CONSOLE_CRONOMETRO_COMPACT_MS:
      cfg.CONSOLE_CRONOMETRO_COMPACT_MS ?? p.compactCronometroMs,
  };
};

module.exports = exports;
