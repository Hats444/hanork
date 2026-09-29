'use strict';

const cfg = require('../config/divulgacao');
const labels = require('../utils/groupLabels');
const statusDailyControl = require('./statusDailyControl');
const statusContentGuard = require('./statusContentGuard');

const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function maxPostsPerDay() {
  return (
    cfg.MAX_POSTS_PER_GROUP_PER_DAY ??
    cfg.MAX_POSTS_PER_GROUP_PER_24H ??
    cfg.GROUP_MAX_STATUS_PER_24H ??
    2
  );
}

function minIntervalMs() {
  return cfg.MIN_GROUP_POST_INTERVAL_MS ?? 12 * 60 * 60 * 1000;
}

function msSince(iso) {
  if (!iso) return Infinity;
  return Date.now() - new Date(iso).getTime();
}

function formatTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(iso);
  }
}

function groupStatus(group, dailyRec) {
  const maxDay = maxPostsPerDay();
  const minGap = minIntervalMs();
  const postsToday = dailyRec?.posts_today ?? group.postsToday ?? 0;
  const lastPostAt = dailyRec?.last_post_at ?? group.lastPostAt ?? null;
  const since = msSince(lastPostAt);
  const atLimit = postsToday >= maxDay;
  const onCooldown = lastPostAt && since < minGap;
  const minutesLeft = onCooldown ? Math.ceil((minGap - since) / 60000) : 0;

  let state = 'ok';
  let stateLabel = '✅ pode postar';
  if (atLimit) {
    state = 'limit';
    stateLabel = '🚫 limite diário';
  } else if (onCooldown) {
    state = 'cooldown';
    stateLabel = `⏳ cooldown ~${minutesLeft}min`;
  }

  return {
    id: group.id,
    shortId: labels.shortId(group.id),
    subject: group.subject || labels.shortId(group.id),
    postsToday,
    maxPerDay: maxDay,
    lastPostAt,
    lastPostLabel: formatTime(lastPostAt),
    minutesLeft,
    state,
    stateLabel,
    score: group.score ?? 0,
  };
}

function loadDailyMap() {
  try {
    const store = require('../utils/debouncedStore');
    const data = store.load('status_daily_control.json', { groups: {} });
    const day = todayKey();
    const map = {};
    for (const [gid, rec] of Object.entries(data.groups || {})) {
      if (!rec || rec.day_reference !== day) {
        map[gid] = { posts_today: 0, last_post_at: rec?.last_post_at || null, day_reference: day };
      } else {
        map[gid] = rec;
      }
    }
    return map;
  } catch {
    return {};
  }
}

function loadRecentHashes(limit = 12) {
  try {
    const store = require('../utils/debouncedStore');
    const data = store.load('status_content_dedup.json', { entries: [], productLastAt: {} });
    const cutoff = Date.now() - DEDUP_WINDOW_MS;
    const entries = (data.entries || [])
      .filter((e) => new Date(e.at).getTime() >= cutoff)
      .sort((a, b) => new Date(b.at) - new Date(a.at))
      .slice(0, limit)
      .map((e) => ({
        hash: e.hash,
        productId: e.productId,
        groupShort: e.groupShort || (e.groupId ? labels.shortId(e.groupId) : null),
        source: e.source,
        at: e.at,
        atLabel: formatTime(e.at),
      }));

    const products = Object.entries(data.productLastAt || {})
      .map(([productId, at]) => ({ productId: Number(productId) || productId, at, atLabel: formatTime(at) }))
      .sort((a, b) => new Date(b.at) - new Date(a.at))
      .slice(0, limit);

    return { entries, products };
  } catch {
    return { entries: [], products: [] };
  }
}

function matchGroupFilter(group, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  if (group.id?.toLowerCase().includes(q)) return true;
  if (labels.shortId(group.id).toLowerCase().includes(q)) return true;
  if ((group.subject || '').toLowerCase().includes(q)) return true;
  return false;
}

exports.getStatusStatsSummary = (opts = {}) => {
  const groupValidator = require('./groupValidator');
  const limit = Math.min(30, Math.max(1, Number(opts.limit) || 12));
  const filter = opts.group || opts.query || null;
  const dailyMap = loadDailyMap();
  const active = groupValidator.loadActiveGroups();

  let groups = Object.values(active)
    .filter((g) => matchGroupFilter(g, filter))
    .map((g) => groupStatus(g, dailyMap[g.id]))
    .sort((a, b) => {
      if (b.postsToday !== a.postsToday) return b.postsToday - a.postsToday;
      return (b.lastPostAt ? new Date(b.lastPostAt).getTime() : 0) -
        (a.lastPostAt ? new Date(a.lastPostAt).getTime() : 0);
    });

  const totals = {
    tracked: groups.length,
    atLimit: groups.filter((g) => g.state === 'limit').length,
    onCooldown: groups.filter((g) => g.state === 'cooldown').length,
    canPost: groups.filter((g) => g.state === 'ok').length,
  };

  groups = groups.slice(0, limit);
  const dedup = loadRecentHashes(limit);

  let antiBan = null;
  try {
    antiBan = require('./riskController').getPauseInfo();
  } catch {
    /* ignore */
  }

  return {
    day: todayKey(),
    maxPerDay: maxPostsPerDay(),
    minIntervalHours: Math.round(minIntervalMs() / 3600000),
    antiBan,
    totals,
    groups,
    recentHashes: dedup.entries,
    productLastPosted: dedup.products,
    filter: filter || null,
  };
};
