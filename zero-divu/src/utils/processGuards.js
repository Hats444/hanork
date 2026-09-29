'use strict';

const { errorLog } = require('./logger');
const logThrottle = require('./logThrottle');

let installed = false;

const IGNORED_REJECTIONS = [
  /connection closed/i,
  /connection was lost/i,
  /stream errored/i,
  /timed out/i,
];

function shouldIgnoreRejection(msg) {
  return IGNORED_REJECTIONS.some((re) => re.test(msg));
}

exports.install = () => {
  if (installed) return;
  installed = true;

  // WSL/SSH: fechar terminal envia SIGHUP — workers WA devem continuar em background.
  if (process.env.HANORK_ZERO_WORKER === '1' || process.env.WA_DIVULGACAO_USER === '1') {
    process.on('SIGHUP', () => {});
  }

  process.on('unhandledRejection', (reason) => {
    const msg = reason?.message || reason?.stack || String(reason);
    if (shouldIgnoreRejection(msg)) {
      if (logThrottle.shouldLog('rejection-closed', 60000)) {
        /* Baileys costuma rejeitar promises após disconnect — esperado no reconnect */
      }
      return;
    }
    errorLog(`Promise não tratada: ${msg}`);
    try {
      require('../services/metrics').inc('retries');
    } catch {
      /* ignore */
    }
  });
};

module.exports = exports;
