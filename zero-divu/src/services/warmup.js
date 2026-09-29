'use strict';

const cfg = require('../config/divulgacao');
const store = require('../utils/debouncedStore');
const { infoLog } = require('../utils/logger');
const logThrottle = require('../utils/logThrottle');

function state() {
  return store.load('warmupState.json', { startedAt: null, completedAt: null });
}

function save(s) {
  store.setCritical('warmupState.json', s);
}

exports.ensureStarted = () => {
  if (!cfg.ENABLE_WARMUP) return state();
  const s = state();
  if (!s.startedAt) {
    s.startedAt = new Date().toISOString();
    save(s);
    if (logThrottle.shouldLog('warmup-start')) {
      const h = Math.round((cfg.WARMUP_DURATION_MS || 0) / 3600000);
      infoLog(`Warm-up ativo por ${h}h — limites reduzidos para proteger a conta`);
    }
  }
  return s;
};

exports.isActive = () => {
  if (!cfg.ENABLE_WARMUP) return false;
  const s = exports.ensureStarted();
  if (s.completedAt) return false;
  const start = new Date(s.startedAt).getTime();
  const duration = cfg.WARMUP_DURATION_MS || 48 * 60 * 60 * 1000;
  if (Date.now() - start >= duration) {
    if (!s.completedAt) {
      s.completedAt = new Date().toISOString();
      save(s);
      infoLog('Warm-up concluído — limites do perfil operacional em vigor');
    }
    return false;
  }
  return true;
};

exports.getProgress = () => {
  const s = exports.ensureStarted();
  const duration = cfg.WARMUP_DURATION_MS || 48 * 60 * 60 * 1000;
  const elapsed = Date.now() - new Date(s.startedAt).getTime();
  const pct = Math.min(100, Math.round((elapsed / duration) * 100));
  const remainingH = Math.max(0, Math.ceil((duration - elapsed) / 3600000));
  return { active: exports.isActive(), percent: pct, remainingHours: remainingH };
};

function factor(key) {
  if (!exports.isActive()) return 1;
  const map = {
    posts: cfg.WARMUP_POSTS_FACTOR ?? 0.55,
    joins: cfg.WARMUP_JOINS_FACTOR ?? 0.5,
    cycle: cfg.WARMUP_CYCLE_CAP_FACTOR ?? 0.7,
    groups: cfg.WARMUP_MAX_GROUPS_FACTOR ?? 0.6,
  };
  return map[key] ?? 1;
}

exports.scaleLimit = (base, key, { min = 1 } = {}) => {
  const n = Number(base) || 0;
  if (!n) return 0;
  if (!exports.isActive()) return n;
  return Math.max(min, Math.floor(n * factor(key)));
};

module.exports = exports;
