'use strict';

const cfg = require('../config/divulgacao');
const { sleep } = require('../utils/sleep');
const logThrottle = require('../utils/logThrottle');
const { debugLog } = require('../utils/logger');

let lastSendAt = 0;
let sendsThisMinute = 0;
let minuteStarted = 0;

function minuteBucket() {
  const now = Date.now();
  if (now - minuteStarted >= 60000) {
    minuteStarted = now;
    sendsThisMinute = 0;
  }
}

exports.beforeSend = async () => {
  const minGap = cfg.FLOOD_GUARD_MIN_GAP_MS ?? 10000;
  const elapsed = Date.now() - lastSendAt;
  if (lastSendAt > 0 && elapsed < minGap) {
    const wait = minGap - elapsed;
    if (logThrottle.shouldLog('flood-gap', 5 * 60 * 1000)) {
      debugLog(`Anti-flood: pausa ${Math.round(wait / 1000)}s entre envios`);
    }
    await sleep(wait);
  }

  minuteBucket();
  const burstMax = cfg.FLOOD_GUARD_BURST_PER_MINUTE ?? 8;
  if (sendsThisMinute >= burstMax) {
    const wait = 60000 - (Date.now() - minuteStarted);
    if (wait > 0) {
      debugLog(`Anti-flood: teto ${burstMax}/min — aguardando ${Math.round(wait / 1000)}s`);
      await sleep(wait);
      minuteBucket();
    }
  }
};

exports.afterSend = () => {
  lastSendAt = Date.now();
  minuteBucket();
  sendsThisMinute++;
};

exports.reset = () => {
  lastSendAt = 0;
  sendsThisMinute = 0;
  minuteStarted = 0;
};

module.exports = exports;
