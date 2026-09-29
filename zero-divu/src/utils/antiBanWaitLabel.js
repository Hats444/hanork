'use strict';

/** Rótulo legível para logs/UI quando anti-ban adia post (evita "~? min"). */
function getAntiBanWaitInfo() {
  const pause = require('../services/riskController').getPauseInfo();
  const antiBan = require('../services/antiBan');
  const limits = antiBan.getLimits();

  if (pause.hardPaused && pause.remainingMin > 0) {
    return {
      label: `${pause.remainingMin} min (pausa anti-ban)`,
      waitMs: Math.max(pause.remainingMin, 5) * 60 * 1000,
    };
  }

  if (limits.posts >= limits.maxPosts) {
    const mins = Math.max(1, Math.ceil(antiBan.getMsUntilHourReset() / 60000));
    return {
      label: `${mins} min (cota posts ${limits.posts}/${limits.maxPosts}/h)`,
      waitMs: antiBan.getMsUntilHourReset() + 30000,
    };
  }

  if (!require('../services/riskController').canPostNow()) {
    return {
      label: 'anti-spam (throttle ativo)',
      waitMs: 3 * 60 * 1000,
    };
  }

  return { label: 'breve', waitMs: 2 * 60 * 1000 };
}

module.exports = { getAntiBanWaitInfo };
