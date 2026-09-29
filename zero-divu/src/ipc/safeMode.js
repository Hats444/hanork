'use strict';

const cfg = require('../config/divulgacao');
const store = require('../utils/debouncedStore');
const { warningLog, infoLog } = require('../utils/logger');

function state() {
  return store.load('safeMode.json', { fails: 0, pausedUntil: 0 });
}

exports.isPaused = () => {
  const s = state();
  if (Date.now() < (s.pausedUntil || 0)) return true;
  return false;
};

exports.recordFail = () => {
  const s = state();
  s.fails = (s.fails || 0) + 1;
  if (s.fails >= (cfg.SAFE_MODE_FAIL_THRESHOLD || 8)) {
    s.pausedUntil = Date.now() + (cfg.SAFE_MODE_COOLDOWN_MS || 2700000);
    s.fails = 0;
    warningLog(`Safe mode ON — pausa ${Math.round(cfg.SAFE_MODE_COOLDOWN_MS / 60000)} min`);
  }
  store.setCritical('safeMode.json', s);
};

exports.recordSuccess = () => {
  const s = state();
  if (s.fails > 0) {
    s.fails = Math.max(0, s.fails - 1);
    store.setCritical('safeMode.json', s);
  }
};

exports.clear = () => {
  store.set('safeMode.json', { fails: 0, pausedUntil: 0 });
  infoLog('Safe mode desligado');
};
