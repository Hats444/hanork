'use strict';

function joinQueuePending() {
  try {
    const jobs = require('../services/persistentQueue').list('join') || [];
    return jobs.filter((j) => j.status === 'pending' || j.status === 'processing').length;
  } catch {
    return 0;
  }
}

exports.getJoinDiagnostics = () => {
  const out = {
    joinsThisHour: 0,
    maxJoinsEffective: 0,
    pendingInvitesDisk: 0,
    joinQueuePersist: joinQueuePending(),
    riskScore: null,
    riskThrottle: 1,
    riskPause: null,
    riskPauseMin: 0,
    autoUpgradeStreak: null,
    autoUpgradeNeed: 4,
  };
  try {
    const lim = require('../services/antiBan').getLimits();
    out.joinsThisHour = lim.joins;
    out.maxJoinsEffective = lim.maxJoins;
  } catch {
    /* ignore */
  }
  try {
    out.pendingInvitesDisk = require('../services/pendingInvites').count();
  } catch {
    /* ignore */
  }
  try {
    const archive = require('../services/inviteLinkArchive');
    out.inviteCatalogTotal = archive.count();
    out.inviteCatalogJoinable = archive.countJoinable();
  } catch {
    /* ignore */
  }
  try {
    const risk = require('../services/riskController');
    const s = risk.getState();
    const now = Date.now();
    out.riskScore = s.riskScore;
    out.riskThrottle = risk.getThrottleFactor();
    if (risk.isHardPaused()) {
      out.riskPause = 'hard';
      out.riskPauseMin = Math.max(
        0,
        Math.ceil((Math.max(s.pausedUntil || 0, s.circuitBrokenUntil || 0) - now) / 60000)
      );
    } else if (risk.isSoftPaused()) {
      out.riskPause = 'soft';
      out.riskPauseMin = Math.max(0, Math.ceil(((s.softPausedUntil || 0) - now) / 60000));
    }
  } catch {
    /* ignore */
  }
  try {
    const ap = require('../services/autoProfile').getStatus();
    out.autoUpgradeStreak = ap.lowRiskStreak;
    out.autoUpgradeNeed = ap.upgradeStreakNeed ?? 4;
  } catch {
    /* ignore */
  }
  return out;
};
