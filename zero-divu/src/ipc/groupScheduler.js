'use strict';

const cfg = require('../config/divulgacao');
const store = require('../utils/debouncedStore');
const { humanDelay } = require('../utils/humanDelay');
const { randomInt } = require('../utils/random');

const FILE = 'schedulerState.json';

function loadState() {
  return store.load(FILE, { groups: {}, version: 1 });
}

function saveState(data) {
  store.setCritical(FILE, data);
}

function getGroupState(jid) {
  const s = loadState();
  if (!s.groups[jid]) {
    s.groups[jid] = {
      nextPostAt: null,
      lastPostAt: null,
      priorityScore: 50,
      trustScore: 50,
      deliveryScore: 50,
      cooldownMultiplier: 1,
      activityScore: 50,
      retryCount: 0,
      lastFailureAt: null,
      joinAgeHours: 0,
      lastMediaUsed: null,
      postHistory: [],
      lastHumanizedDelay: 0,
    };
    saveState(s);
  }
  return s.groups[jid];
}

function updateGroup(jid, fn) {
  const s = loadState();
  const prev = s.groups[jid] || getGroupState(jid);
  s.groups[jid] = fn({ ...prev });
  saveState(s);
  return s.groups[jid];
}

function minIntervalMs(group) {
  const slot = cfg.GROUP_STATUS_SLOT_MS ?? 12 * 60 * 60 * 1000;
  const jitter = cfg.GROUP_STATUS_SLOT_JITTER_MS ?? 50 * 60 * 1000;
  const baseMin = cfg.MIN_GROUP_POST_INTERVAL_MS ?? Math.max(slot - jitter, slot * 0.85);
  const baseMax = cfg.MAX_GROUP_POST_INTERVAL_MS ?? Math.min(slot + jitter, slot * 1.15);
  const mult = group?.cooldownMultiplier ?? 1;
  const raw = humanDelay(baseMin, baseMax, { skew: 0.35 });
  const cap = slot * 1.25;
  return Math.round(Math.min(raw * mult, cap));
}

function pruneHistory(history, windowMs = 24 * 60 * 60 * 1000) {
  const cutoff = Date.now() - windowMs;
  return (history || []).filter((iso) => new Date(iso).getTime() >= cutoff);
}

function postsInWindow(group, windowMs) {
  const hist = pruneHistory(group.postHistory || [], windowMs);
  return hist.length;
}

exports.scheduleNextPost = (jid, groupMeta = {}, meta = {}) => {
  const delay = minIntervalMs(groupMeta);
  const at = new Date(Date.now() + delay).toISOString();
  updateGroup(jid, (g) => ({
    ...g,
    lastPostAt: new Date().toISOString(),
    nextPostAt: at,
    retryCount: 0,
    postHistory: pruneHistory([...(g.postHistory || []), new Date().toISOString()]),
    lastHumanizedDelay: delay,
    lastMediaUsed: meta.mediaKey ?? g.lastMediaUsed,
  }));
  try {
    require('./timerRegistry').register(`post:${jid}`, Date.now() + delay, { jid });
  } catch {
    /* ignore */
  }
  try {
    require('./groupEventScheduler').reschedule(jid);
  } catch {
    /* ignore */
  }
  return at;
};

exports.recordFailure = (jid) => {
  updateGroup(jid, (g) => ({
    ...g,
    retryCount: (g.retryCount || 0) + 1,
    lastFailureAt: new Date().toISOString(),
    deliveryScore: Math.max(0, (g.deliveryScore || 50) - 8),
    cooldownMultiplier: Math.min(2.5, (g.cooldownMultiplier || 1) + 0.15),
  }));
};

exports.isDue = (jid, group) => {
  const st = getGroupState(jid);
  if (!st.nextPostAt) return true;
  if (!group?.lastPostAt) return true;
  return Date.now() >= new Date(st.nextPostAt).getTime();
};

exports.getSkipReason = (jid, group) => {
  const max24 =
    cfg.GROUP_MAX_STATUS_PER_24H ??
    cfg.MAX_POSTS_PER_GROUP_PER_24H ??
    cfg.MAX_POSTS_PER_GROUP_PER_DAY ??
    2;
  const st = getGroupState(jid);
  const merged = { ...st, postHistory: group?.postHistory || st.postHistory };
  const count24 = postsInWindow(merged, 24 * 60 * 60 * 1000);
  if (count24 >= max24) {
    return `limite ${max24}/24h (janela deslizante)`;
  }
  if (!exports.isDue(jid, group)) {
    const nextMs = new Date(st.nextPostAt).getTime();
    const left =
      Number.isFinite(nextMs) && nextMs > Date.now()
        ? Math.ceil((nextMs - Date.now()) / 60000)
        : 0;
    return left > 0 ? `agendado (aguardar ~${left} min)` : 'agendado (breve)';
  }
  return null;
};

exports.computePriority = (group, jid) => {
  const st = getGroupState(jid);
  const score =
    (group.score || 50) * 0.35 +
    (st.trustScore || 50) * 0.25 +
    (st.deliveryScore || 50) * 0.25 +
    (st.activityScore || 50) * 0.15;
  if (!group.lastPostAt) return score + 30;
  const hours = (Date.now() - new Date(group.lastPostAt).getTime()) / 3600000;
  return score + Math.min(20, hours / 2);
};

exports.pickForCycle = (candidates, maxCount) => {
  const cap = maxCount > 0 ? maxCount : candidates.length;
  const scored = candidates
    .map((g) => ({
      group: g,
      priority: exports.computePriority(g, g.id),
      jitter: randomInt(0, 15),
    }))
    .sort((a, b) => b.priority + b.jitter - (a.priority + a.jitter));

  const picked = [];
  const recent = [];

  for (const item of scored) {
    if (picked.length >= cap) break;
    const gid = item.group.id;
    if (recent.includes(gid)) continue;
    const skip = exports.getSkipReason(gid, item.group);
    if (skip) continue;
    picked.push(item.group);
    recent.push(gid);
  }

  return picked.map((g) => g.id);
};

exports.syncFromGroup = (jid, group) => {
  if (!group) return;
  try {
    require('./groupReputation').get(jid, group);
  } catch {
    /* ignore */
  }
  updateGroup(jid, (g) => ({
    ...g,
    lastPostAt: group.lastPostAt || g.lastPostAt,
    postHistory: group.postHistory || g.postHistory || [],
    joinAgeHours: group.joinedAt
      ? Math.round((Date.now() - new Date(group.joinedAt).getTime()) / 3600000)
      : g.joinAgeHours,
  }));
};

exports.loadGroupState = getGroupState;
exports.loadState = loadState;
exports.updateGroup = updateGroup;

module.exports = exports;
