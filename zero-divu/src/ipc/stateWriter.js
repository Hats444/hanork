'use strict';

const fs = require('fs-extra');
const cfg = require('../config/divulgacao');
const { FILES, ensureDir } = require('./paths');
const runtimeBridge = require('./runtimeBridge');

function pickLastPostAt() {
  try {
    const active = require('../services/groupValidator').loadActiveGroups();
    let latest = null;
    for (const g of Object.values(active || {})) {
      if (g.lastPostAt && (!latest || g.lastPostAt > latest)) latest = g.lastPostAt;
    }
    return latest;
  } catch {
    return null;
  }
}

function buildSnapshot(overrides = {}) {
  const rt = runtimeBridge.getRuntime();
  let activeGroups = 0;
  try {
    activeGroups = require('../services/groupValidator').countActive();
  } catch {
    /* ignore */
  }
  let paused = false;
  try {
    paused = require('./runtimeControls').isPostsPaused();
  } catch {
    /* ignore */
  }
  let joinQueue = 0;
  try {
    const jobs = require('../services/persistentQueue').list('join') || [];
    joinQueue = jobs.filter((j) => j.status === 'pending' || j.status === 'processing').length;
  } catch {
    /* ignore */
  }
  let maxGroupsEffective = cfg.MAX_GROUPS ?? 20;
  try {
    maxGroupsEffective = require('../services/operationalLimits').getMaxGroups();
  } catch {
    /* ignore */
  }
  return {
    updatedAt: new Date().toISOString(),
    ipcOnline: true,
    connected: Boolean(rt.connected),
    phone: rt.phone || null,
    profile: cfg.OPERATION_PROFILE || 'safe',
    maxGroups: cfg.MAX_GROUPS ?? 20,
    maxGroupsEffective,
    maxGroupsPinned: (() => {
      try {
        return Boolean(require('./configApplier').getPatch().maxGroupsPinned);
      } catch {
        return false;
      }
    })(),
    activeGroups,
    minMembers: cfg.MIN_MEMBERS_IN_GROUP ?? 0,
    autoJoinGroups: Boolean(cfg.AUTO_JOIN_GROUPS),
    autoPostOnJoin: Boolean(cfg.AUTO_POST_ON_JOIN),
    maxJoinPerHour: cfg.MAX_JOIN_PER_HOUR,
    paused,
    postsPaused: paused,
    joinQueue,
    waSessionId: process.env.WA_SESSION_ID || 'wa_a',
    waDisplayName: process.env.WA_DISPLAY_NAME || 'WA 1',
    lastPostAt: pickLastPostAt(),
    workerPid: process.pid,
    botRunning: Boolean(rt.botRunning),
    postDelayMin: cfg.POST_DELAY_MIN,
    postDelayMax: cfg.POST_DELAY_MAX,
    joinDelayMin: cfg.JOIN_DELAY_MIN,
    joinDelayMax: cfg.JOIN_DELAY_MAX,
    promoQueue: (() => {
      try {
        return require('./promoQueue').pendingCount();
      } catch {
        return 0;
      }
    })(),
    promoNext: (() => {
      try {
        return require('./promoQueue').getNextScheduled();
      } catch {
        return null;
      }
    })(),
    antiBanWait: (() => {
      try {
        return require('../utils/antiBanWaitLabel').getAntiBanWaitInfo().label;
      } catch {
        return null;
      }
    })(),
    hanorkCampaignEnabled: (() => {
      try {
        return require('./runtimeSettings').isHanorkCampaignEnabled();
      } catch {
        return true;
      }
    })(),
    hanorkAutoSyncEnabled: (() => {
      try {
        return require('./runtimeSettings').isHanorkAutoSyncEnabled();
      } catch {
        return true;
      }
    })(),
    hanorkAutoSyncCount: (() => {
      try {
        return require('./hanorkAutoCatalog').summary().count || 0;
      } catch {
        return 0;
      }
    })(),
    hanorkAutoSyncAt: (() => {
      try {
        return require('./hanorkAutoCatalog').summary().updatedAt || null;
      } catch {
        return null;
      }
    })(),
    syncHealth: (() => {
      try {
        return require('../services/syncHealth').getSnapshot();
      } catch {
        return null;
      }
    })(),
    postsZero24h: (() => {
      try {
        return require('../services/monitor').getStats().postsZero || 0;
      } catch {
        return 0;
      }
    })(),
    postsHanork24h: (() => {
      try {
        return require('../services/monitor').getStats().postsHanork || 0;
      } catch {
        return 0;
      }
    })(),
    autoProfile: (() => {
      try {
        return require('../services/autoProfile').isEnabled();
      } catch {
        return true;
      }
    })(),
    spamRiskScore: (() => {
      try {
        return require('../services/autoProfile').evaluateRisk().score;
      } catch {
        return null;
      }
    })(),
    spamRiskReasons: (() => {
      try {
        return require('../services/autoProfile').evaluateRisk().reasons.slice(0, 3);
      } catch {
        return [];
      }
    })(),
    ...(() => {
      try {
        return require('./joinDiagnostics').getJoinDiagnostics();
      } catch {
        return {};
      }
    })(),
    maxJoinPerHourEffective: (() => {
      try {
        return require('../services/operationalLimits').getMaxJoinsPerHour();
      } catch {
        return null;
      }
    })(),
    ...overrides,
  };
}

exports.writeStateSnapshot = async (overrides = {}) => {
  ensureDir();
  const snap = buildSnapshot(overrides);
  await fs.writeJson(FILES.state, snap, { spaces: 2 });
  return snap;
};

exports.buildSnapshot = buildSnapshot;
