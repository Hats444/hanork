'use strict';

const env = require('../utils/environmentDetector');
const { infoLog } = require('../utils/logger');

function detectManager() {
  const e = env.get();
  if (process.env.pm_id != null || process.env.PM2_HOME) {
    return { id: 'pm2', label: 'PM2', restart: 'pm2 restart zero-divu' };
  }
  if (process.env.INVOCATION_ID && e.hasSystemd) {
    return { id: 'systemd', label: 'systemd', restart: 'systemctl restart zero-divu' };
  }
  if (e.isTermux) {
    return { id: 'termux', label: 'Termux (manual)', restart: './start.sh' };
  }
  if (e.isWSL) {
    return { id: 'wsl', label: 'WSL (manual)', restart: 'npm run bot' };
  }
  return { id: 'manual', label: 'manual', restart: 'npm run bot' };
}

exports.get = () => {
  const e = env.get();
  const mgr = detectManager();
  return {
    ...mgr,
    platform: e.platform,
    arch: e.arch,
    isTermux: e.isTermux,
    hasPm2: e.hasPm2,
    hasSystemd: e.hasSystemd,
  };
};

exports.logOnBoot = () => {
  const m = exports.get();
  infoLog(`Process manager: ${m.label}${m.id === 'manual' && m.isTermux ? ' · use ./start.sh + wake-lock' : ''}`);
  if (m.id === 'manual' && !m.isTermux && m.hasPm2) {
    infoLog('Dica VPS: pm2 start ecosystem.config.js');
  }
};

module.exports = exports;
