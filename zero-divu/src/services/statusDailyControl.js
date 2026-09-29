'use strict';

const cfg = require('../config/divulgacao');
const store = require('../utils/debouncedStore');
const labels = require('../utils/groupLabels');
const { skipLog } = require('../utils/logger');

const FILE = 'status_daily_control.json';
const DEFAULT_MAX_PER_DAY = 2;
const DEFAULT_MIN_INTERVAL_MS = 12 * 60 * 60 * 1000;

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function load() {
  return store.load(FILE, { groups: {} });
}

function save(data) {
  store.setCritical(FILE, data);
}

function shortId(groupId) {
  return labels.shortId(groupId);
}

function maxPostsPerDay() {
  return (
    cfg.MAX_POSTS_PER_GROUP_PER_DAY ??
    cfg.MAX_POSTS_PER_GROUP_PER_24H ??
    cfg.GROUP_MAX_STATUS_PER_24H ??
    DEFAULT_MAX_PER_DAY
  );
}

function minIntervalMs() {
  return cfg.MIN_GROUP_POST_INTERVAL_MS ?? DEFAULT_MIN_INTERVAL_MS;
}

function normalizeRecord(groupId, rec) {
  const day = todayKey();
  const base = rec && typeof rec === 'object' ? rec : {};
  if (base.day_reference !== day) {
    return {
      group_id: groupId,
      last_post_at: base.last_post_at || null,
      posts_today: 0,
      day_reference: day,
    };
  }
  return {
    group_id: groupId,
    last_post_at: base.last_post_at || null,
    posts_today: Number(base.posts_today) || 0,
    day_reference: day,
  };
}

function getRecord(groupId) {
  const data = load();
  const rec = normalizeRecord(groupId, data.groups[groupId]);
  data.groups[groupId] = rec;
  save(data);
  return rec;
}

function msSince(iso) {
  if (!iso) return Infinity;
  return Date.now() - new Date(iso).getTime();
}

exports.checkGroupLimits = (groupId) => {
  if (!groupId) return { ok: false, reason: 'grupo inválido', tag: 'STATUS_BLOCKED' };

  const rec = getRecord(groupId);
  const maxDay = maxPostsPerDay();

  if (rec.posts_today >= maxDay) {
    skipLog(groupId, 'daily_limit_reached', {
      source: 'postGuard',
      postsToday: rec.posts_today,
      max: maxDay,
    });
    return {
      ok: false,
      reason: `limite diário (${maxDay}/dia)`,
      tag: 'STATUS_LIMIT_REACHED',
      postsToday: rec.posts_today,
    };
  }

  const minGap = minIntervalMs();
  const since = msSince(rec.last_post_at);
  if (rec.last_post_at && since < minGap) {
    const minLeft = Math.ceil((minGap - since) / 60000);
    skipLog(groupId, 'cooldown_active', {
      source: 'postGuard',
      lastPostAt: rec.last_post_at,
      waitMin: minLeft,
    });
    return {
      ok: false,
      reason: `post recente (aguardar ~${minLeft} min)`,
      tag: 'STATUS_COOLDOWN_ACTIVE',
      minutesLeft: minLeft,
    };
  }

  return { ok: true };
};

exports.syncPostSuccess = (groupId, { postsToday, lastPostAt } = {}) => {
  if (!groupId) return null;
  const now = lastPostAt || new Date().toISOString();
  const day = todayKey();

  const data = load();
  const rec = normalizeRecord(groupId, data.groups[groupId]);
  rec.last_post_at = now;
  rec.posts_today = Number(postsToday) || (rec.posts_today || 0) + 1;
  rec.day_reference = day;
  data.groups[groupId] = rec;
  save(data);
  return rec;
};

exports.getRecord = getRecord;
exports.syncFromGroup = (group) => {
  if (!group?.id) return null;
  const data = load();
  const rec = normalizeRecord(group.id, {
    last_post_at: group.lastPostAt || null,
    posts_today: group.postsToday || 0,
    day_reference: group.postDay || todayKey(),
  });
  data.groups[group.id] = rec;
  save(data);
  return rec;
};
