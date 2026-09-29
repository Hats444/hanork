'use strict';

const fs = require('fs-extra');
const path = require('path');
const cfg = require('../config/divulgacao');
const store = require('../utils/debouncedStore');

const cfgPath = path.join(__dirname, '../config/whitelist.json');

function loadWl() {
  try {
    return fs.readJsonSync(cfgPath);
  } catch {
    return { enabled: false, senders: [] };
  }
}

exports.isSenderAllowed = (senderJid) => {
  const wl = loadWl();
  if (!wl.enabled && !cfg.WHITELIST_ONLY) return true;
  if (!wl.enabled) return true;
  return wl.senders.some((s) => senderJid.includes(String(s).replace(/\D/g, '')) || senderJid === s);
};

exports.loadActiveGroups = () => store.load('gruposAtivos.json', {});

exports.saveActiveGroups = (data) => store.set('gruposAtivos.json', data);

exports.loadInvalidGroups = () => store.load('gruposInvalidos.json', {});

exports.markInvalid = (jid, reason) => {
  store.updateCritical('gruposInvalidos.json', (inv) => {
    inv[jid] = { reason, at: new Date().toISOString() };
    return inv;
  }, {});
  store.updateCritical('gruposAtivos.json', (active) => {
    delete active[jid];
    return active;
  }, {});
};

exports.clearInvalid = (jid) => {
  store.updateCritical('gruposInvalidos.json', (inv) => {
    delete inv[jid];
    return inv;
  }, {});
};

exports.restoreGroup = (jid, meta = {}) => exports.registerGroup(jid, meta);

exports.registerGroup = (jid, meta = {}) => {
  const localSession = process.env.WA_SESSION_ID || 'wa_a';
  store.updateCritical('gruposAtivos.json', (active) => {
    const prev = active[jid] || {};
    const merged = {
      ...prev,
      ...meta,
      id: jid,
      wa_session_id: meta.wa_session_id || prev.wa_session_id || localSession,
      joinedAt: prev.joinedAt || new Date().toISOString(),
      lastPostAt: prev.lastPostAt || null,
      postsOk: prev.postsOk || 0,
      postsFail: prev.postsFail || 0,
      errors: prev.errors || 0,
      score: prev.score ?? 100,
    };
    if (merged.groupType === 'divulgacao' && merged.postPermission !== 'denied') {
      if (!merged.classifyAction) merged.classifyAction = 'stay_cautious';
      if (!merged.postPermission) {
        merged.postPermission =
          cfg.GROUP_CLASSIFY_DEFAULT_OPEN === true ? 'allowed' : 'unknown';
      }
    }
    active[jid] = merged;
    return active;
  }, {});
  try {
    const dualGroupRegistry = require('./dualGroupRegistry');
    if (dualGroupRegistry.dualEnabled()) {
      const row = exports.loadActiveGroups()[jid] || {};
      dualGroupRegistry.claimGroup(jid, row.wa_session_id || meta.wa_session_id || localSession, {
        subject: row.subject || meta.subject,
      });
    }
  } catch {
    /* ignore */
  }
  return exports.loadActiveGroups()[jid];
};

exports.countActive = () => Object.keys(exports.loadActiveGroups()).length;

exports.listSortedByScore = () => {
  const active = exports.loadActiveGroups();
  return Object.values(active).sort((a, b) => (b.score || 0) - (a.score || 0));
};

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

exports.recordPostResult = (jid, ok, meta = {}) => {
  store.update('gruposAtivos.json', (active) => {
    if (!active[jid]) return active;
    const day = todayKey();
    if (active[jid].postDay !== day) {
      active[jid].postDay = day;
      active[jid].postsToday = 0;
    }
    if (ok) {
      if (meta.campaignId) active[jid].lastStatusCampaign = meta.campaignId;
      active[jid].postsOk = (active[jid].postsOk || 0) + 1;
      active[jid].postsToday = (active[jid].postsToday || 0) + 1;
      active[jid].lastPostAt = new Date().toISOString();
      try {
        require('./statusDailyControl').syncPostSuccess(jid, {
          postsToday: active[jid].postsToday,
          lastPostAt: active[jid].lastPostAt,
        });
      } catch {
        /* ignore */
      }
      active[jid].postHistory = [
        ...(active[jid].postHistory || []),
        active[jid].lastPostAt,
      ].slice(-12);
      active[jid].score = (active[jid].score || 100) + 2;
      active[jid].errors = Math.max(0, (active[jid].errors || 0) - 1);
      active[jid].statusFailCount = 0;
    } else {
      active[jid].postsFail = (active[jid].postsFail || 0) + 1;
      active[jid].errors = (active[jid].errors || 0) + 1;
      active[jid].lastFailAt = new Date().toISOString();
      active[jid].score = Math.max(0, (active[jid].score || 100) - 5);
    }
    return active;
  }, {});

  try {
    if (ok) {
      const group = exports.loadActiveGroups()[jid];
      require('./groupReputation').onDeliverySuccess(jid, group);
      require('./groupScheduler').scheduleNextPost(jid, group, { mediaKey: meta.mediaKey });
      require('./metrics').inc('postsOk');
    } else {
      require('./groupReputation').onDeliveryFailure(jid);
      require('./groupScheduler').recordFailure(jid);
      require('./metrics').inc('postsFail');
    }
  } catch {
    /* módulos opcionais */
  }
};
