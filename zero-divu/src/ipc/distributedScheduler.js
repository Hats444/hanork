'use strict';

const cfg = require('../config/divulgacao');
const groupScheduler = require('./groupScheduler');
const groupValidator = require('./groupValidator');
const groupClassifier = require('./groupClassifier');
const groupHealth = require('./groupHealth');
const { humanDelay } = require('../utils/humanDelay');
const { randomInt } = require('../utils/random');

function wakeBounds() {
  return {
    min: cfg.SCHEDULER_WAKE_MIN_MS ?? 45 * 1000,
    max: cfg.SCHEDULER_WAKE_MAX_MS ?? 5 * 60 * 1000,
  };
}

function listCandidates() {
  const list = groupValidator.listSortedByScore();
  if (!cfg.ENABLE_GROUP_CLASSIFIER) return list;
  return list.filter((g) => groupClassifier.isEligibleForCycle(g));
}

/** Próximo intervalo de wake baseado em nextPostAt dos grupos elegíveis */
exports.computeNextWakeMs = () => {
  const { min, max } = wakeBounds();
  const candidates = listCandidates();
  if (!candidates.length) return humanDelay(max * 0.8, max);

  for (const g of candidates) {
    groupScheduler.syncFromGroup(g.id, g);
  }

  const { ok } = groupHealth.filterHealthy(candidates);
  if (!ok.length) return humanDelay(min, max);

  const dueNow = groupScheduler.pickForCycle(ok, 1);
  if (dueNow.length) {
    let delay = humanDelay(3000, 12000);
    try {
      delay = Math.round(delay * require('./runtimeRecovery').getRecoveryDelayFactor());
    } catch {
      /* ignore */
    }
    return delay;
  }

  let earliest = null;
  for (const g of ok) {
    const st = groupScheduler.loadGroupState(g.id);
    if (!st.nextPostAt) return humanDelay(min, min + 20000);
    const t = new Date(st.nextPostAt).getTime();
    if (earliest === null || t < earliest) earliest = t;
  }

  if (earliest === null) return humanDelay(min, max);

  const delta = earliest - Date.now();
  if (delta <= 0) return humanDelay(3000, 10000);

  const jitter = randomInt(8000, 45000);
  let wake = Math.min(max, Math.max(min, delta + jitter));
  try {
    wake = Math.round(wake * require('./runtimeRecovery').getRecoveryDelayFactor());
  } catch {
    /* ignore */
  }
  return wake;
};

exports.isEnabled = () => cfg.DISTRIBUTED_SCHEDULER_ENABLED !== false;

exports.maxGroupsPerWake = () => {
  if (!exports.isEnabled()) return 0;
  let cap = cfg.DISTRIBUTED_MAX_GROUPS_PER_WAKE ?? 1;
  try {
    const recoveryCap = require('./runtimeRecovery').getRecoveryPostCap();
    if (recoveryCap !== null) cap = Math.min(cap, recoveryCap);
  } catch {
    /* ignore */
  }
  return cap > 0 ? cap : 1;
};

exports.describeNextWake = () => {
  const ms = exports.computeNextWakeMs();
  const min = Math.round(ms / 60000);
  return min < 1 ? `~${Math.round(ms / 1000)}s` : `~${min} min`;
};

module.exports = exports;
