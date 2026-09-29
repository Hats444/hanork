'use strict';

const cfg = require('../config/divulgacao');
const groupScheduler = require('./groupScheduler');
const store = require('../utils/debouncedStore');

const FILE = 'groupReputation.json';

function load() {
  return store.load(FILE, { groups: {} });
}

function save(data) {
  store.set('groupReputation.json', data);
}

function ensure(jid, group = null) {
  const data = load();
  if (!data.groups[jid]) {
    data.groups[jid] = {
      trustScore: 50,
      deliveryScore: 50,
      activityScore: 50,
      successStreak: 0,
      failStreak: 0,
      updatedAt: new Date().toISOString(),
    };
    save(data);
  }
  const rep = data.groups[jid];

  if (group) {
    if (group.pendingApproval) {
      rep.trustScore = Math.max(0, (rep.trustScore || 50) - 10);
    }
    if (group.joinedAt) {
      const ageHours = (Date.now() - new Date(group.joinedAt).getTime()) / 3600000;
      if (ageHours >= 168) rep.trustScore = Math.min(100, (rep.trustScore || 50) + 5);
      else if (ageHours >= 48) rep.trustScore = Math.min(100, (rep.trustScore || 50) + 2);
    }
    if (!group.desc && group.subject && group.subject.length < 4) {
      rep.trustScore = Math.max(0, (rep.trustScore || 50) - 3);
    }
    if ((group.errors || 0) >= 2) {
      rep.deliveryScore = Math.max(0, (rep.deliveryScore || 50) - 5);
    }
  }

  return rep;
}

exports.onDeliverySuccess = (jid, group) => {
  const rep = ensure(jid, group);
  rep.trustScore = Math.min(100, (rep.trustScore || 50) + 3);
  rep.deliveryScore = Math.min(100, (rep.deliveryScore || 50) + 4);
  rep.successStreak = (rep.successStreak || 0) + 1;
  rep.failStreak = 0;
  rep.updatedAt = new Date().toISOString();

  const size = group?.size || 0;
  if (size >= 50) rep.activityScore = Math.min(100, (rep.activityScore || 50) + 2);
  else if (size >= 20) rep.activityScore = Math.min(100, (rep.activityScore || 50) + 1);

  store.update('groupReputation.json', (data) => {
    data.groups[jid] = rep;
    return data;
  }, { groups: {} });

  groupScheduler.updateGroup(jid, (g) => ({
    ...g,
    trustScore: rep.trustScore,
    deliveryScore: rep.deliveryScore,
    activityScore: rep.activityScore,
    cooldownMultiplier: Math.max(1, (g.cooldownMultiplier || 1) - 0.05),
  }));
};

exports.onDeliveryFailure = (jid, reason = '') => {
  const rep = ensure(jid);
  rep.trustScore = Math.max(0, (rep.trustScore || 50) - 4);
  rep.deliveryScore = Math.max(0, (rep.deliveryScore || 50) - 6);
  rep.failStreak = (rep.failStreak || 0) + 1;
  rep.successStreak = 0;
  rep.lastReason = String(reason).slice(0, 120);
  rep.updatedAt = new Date().toISOString();

  store.update('groupReputation.json', (data) => {
    data.groups[jid] = rep;
    return data;
  }, { groups: {} });

  groupScheduler.recordFailure(jid);
};

exports.get = (jid, group = null) => ensure(jid, group);

exports.shouldDeprioritize = (jid) => {
  const rep = ensure(jid);
  const threshold = cfg.REPUTATION_PAUSE_THRESHOLD ?? 25;
  return (rep.deliveryScore || 50) < threshold || (rep.failStreak || 0) >= 4;
};

exports.averageScores = () => {
  const data = load();
  const vals = Object.values(data.groups);
  if (!vals.length) return { trust: 50, delivery: 50, activity: 50, count: 0 };
  const sum = vals.reduce(
    (a, g) => ({
      trust: a.trust + (g.trustScore || 50),
      delivery: a.delivery + (g.deliveryScore || 50),
      activity: a.activity + (g.activityScore || 50),
    }),
    { trust: 0, delivery: 0, activity: 0 }
  );
  const n = vals.length;
  return {
    trust: Math.round(sum.trust / n),
    delivery: Math.round(sum.delivery / n),
    activity: Math.round(sum.activity / n),
    count: n,
  };
};

module.exports = exports;
