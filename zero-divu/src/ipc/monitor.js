'use strict';

const cfg = require('../config/divulgacao');
const { readJson, writeJson } = require('../utils/jsonStore');
const groupValidator = require('./groupValidator');
const blacklist = require('./blacklist');
const schedulerClock = require('../utils/schedulerClock');

const started = Date.now();

const stats = readJson('stats.json', {
  postsSent: 0,
  postsZero: 0,
  postsHanork: 0,
  invitesProcessed: 0,
  joinsOk: 0,
  joinsFail: 0,
  groupsLeft: 0,
  ghostsRemoved: 0,
  groupUpgrades: 0,
  leftSmallGroup: 0,
});

function saveStats() {
  writeJson('stats.json', stats);
}

function countByType() {
  const active = groupValidator.loadActiveGroups();
  let divulgacao = 0;
  let chat = 0;
  let mixed = 0;
  let pending = 0;
  let cycle = 0;
  for (const g of Object.values(active)) {
    if (g.pendingApproval) pending++;
    else if (g.groupType === 'divulgacao') divulgacao++;
    else if (g.groupType === 'chat') chat++;
    else if (g.groupType === 'mixed') mixed++;
    const groupClassifier = require('./groupClassifier');
    if (groupClassifier.isEligibleForCycle(g)) cycle++;
  }
  return { divulgacao, chat, mixed, pending, cycle, total: Object.keys(active).length };
}

exports.countGroupTypes = countByType;

exports.inc = (key, n = 1) => {
  stats[key] = (stats[key] || 0) + n;
  saveStats();
};

exports.getStats = () => ({ ...stats });

exports.tick = (opts = {}) => {
  if (!cfg.ENABLE_LOGS) return;

  const types = countByType();
  const bl = blacklist.getStats();

  let metrics = {};
  let queues = {};
  let reputation = {};
  try {
    metrics = require('./metrics').snapshot();
  } catch {
    /* ignore */
  }
  try {
    const pq = require('./persistentQueue');
    queues = {
      join: pq.count('join'),
      delivery: pq.count('delivery'),
      retry: pq.count('retry'),
    };
  } catch {
    /* ignore */
  }
  try {
    reputation = require('./groupReputation').averageScores();
  } catch {
    /* ignore */
  }

  if (opts.full) {
    schedulerClock.render();
    return;
  }

  writeJson('logs.json', {
    at: new Date().toISOString(),
    uptime: Date.now() - started,
    groups: types,
    stats,
    blacklist: bl,
    clock: schedulerClock.getState(),
    metrics,
    queues,
    reputation,
    activeHours: require('../utils/activeHours').describe(),
    lastCheckpoint: (() => {
      try {
        return require('./checkpoints').getLast();
      } catch {
        return null;
      }
    })(),
  });

  try {
    require('./autoProfile').maybeAdjust();
  } catch {
    /* ignore */
  }
};

module.exports = exports;
