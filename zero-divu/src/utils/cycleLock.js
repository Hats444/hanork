'use strict';

const logThrottle = require('./logThrottle');
const { warningLog } = require('./logger');

let busy = false;
let owner = null;
let busySince = 0;

exports.isBusy = () => busy;

exports.getOwner = () => owner;

exports.busyForMs = () => (busy ? Date.now() - busySince : 0);

exports.runExclusive = async (name, fn) => {
  if (busy) {
    if (logThrottle.shouldLog(`cycle-busy-${name}`, 60 * 1000)) {
      warningLog(`Ciclo "${owner}" em execução — "${name}" ignorado desta vez`);
    }
    return { skipped: true, reason: `ciclo ${owner} ativo` };
  }

  busy = true;
  owner = name;
  busySince = Date.now();
  try {
    const result = await fn();
    return { skipped: false, result };
  } finally {
    busy = false;
    owner = null;
    busySince = 0;
  }
};

exports.forceReset = (reason = 'reset') => {
  if (busy && logThrottle.shouldLog('cycle-force-reset')) {
    warningLog(`Trava de ciclo liberada (${reason})`);
  }
  busy = false;
  owner = null;
  busySince = 0;
};

module.exports = exports;
