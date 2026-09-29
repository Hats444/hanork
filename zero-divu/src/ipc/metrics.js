'use strict';

const store = require('../utils/debouncedStore');

const FILE = 'metricsState.json';
const HOUR_MS = 60 * 60 * 1000;

function load() {
  return store.load(FILE, {
    postsOk: 0,
    postsFail: 0,
    retries: 0,
    skips: 0,
    deliveries: 0,
    avgDelayMs: 0,
    avgDeliveryMs: 0,
    _delaySamples: [],
    _deliverySamples: [],
    _hourlyPosts: [],
    startedAt: new Date().toISOString(),
  });
}

function save(data) {
  store.set('metricsState.json', data);
}

function pruneHourly(list) {
  const cutoff = Date.now() - HOUR_MS;
  return (list || []).filter((e) => new Date(e.at).getTime() >= cutoff);
}

exports.inc = (key, n = 1) => {
  const m = load();
  m[key] = (m[key] || 0) + n;
  if (key === 'postsOk' || key === 'deliveries') {
    m._hourlyPosts = pruneHourly([...(m._hourlyPosts || []), { at: new Date().toISOString(), n }]);
  }
  save(m);
};

exports.recordDelay = (ms) => {
  const m = load();
  const samples = [...(m._delaySamples || []), ms].slice(-50);
  m._delaySamples = samples;
  m.avgDelayMs = Math.round(samples.reduce((a, b) => a + b, 0) / samples.length);
  save(m);
};

exports.recordDelivery = (ms) => {
  const m = load();
  const samples = [...(m._deliverySamples || []), ms].slice(-50);
  m._deliverySamples = samples;
  m.avgDeliveryMs = Math.round(samples.reduce((a, b) => a + b, 0) / samples.length);
  save(m);
};

exports.getPostsPerHour = () => {
  const m = load();
  const hourly = pruneHourly(m._hourlyPosts || []);
  return hourly.reduce((a, e) => a + (e.n || 1), 0);
};

exports.getThroughputPerHour = () => exports.getPostsPerHour();

exports.getDeadGroupCount = () => {
  try {
    const active = require('./groupValidator').loadActiveGroups();
    let dead = 0;
    for (const g of Object.values(active)) {
      if (g.healthPaused && g.healthStatus === 'dead') dead++;
    }
    return dead;
  } catch {
    return 0;
  }
};

exports.snapshot = () => {
  const m = load();
  const rep = require('./groupReputation').averageScores();
  return {
    postsOk: m.postsOk || 0,
    postsFail: m.postsFail || 0,
    retries: m.retries || 0,
    skips: m.skips || 0,
    deliveries: m.deliveries || 0,
    avgDelayMs: m.avgDelayMs || 0,
    avgDeliveryMs: m.avgDeliveryMs || 0,
    postsPerHour: exports.getPostsPerHour(),
    throughputPerHour: exports.getThroughputPerHour(),
    deadGroups: exports.getDeadGroupCount(),
    reputation: rep,
    uptimeHours: Math.round((Date.now() - new Date(m.startedAt).getTime()) / 3600000),
    startedAt: m.startedAt,
  };
};

exports.restore = (data) => {
  if (!data || typeof data !== 'object') return false;
  store.setCritical(FILE, {
    ...load(),
    ...data,
    _delaySamples: data._delaySamples || [],
    _deliverySamples: data._deliverySamples || [],
    _hourlyPosts: data._hourlyPosts || [],
  });
  return true;
};

module.exports = exports;
