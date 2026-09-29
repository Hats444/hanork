'use strict';

const cfg = require('../config/divulgacao');
const store = require('../utils/debouncedStore');
const { humanDelay } = require('../utils/humanDelay');

const FILE = 'patternGuardState.json';
const MAX_HISTORY = 48;

function load() {
  return store.load(FILE, {
    postHours: [],
    mediaUsed: [],
    textHashes: [],
    groupSequence: [],
    lastDelays: [],
  });
}

function save(data) {
  store.set('patternGuardState.json', data);
}

function pushLimited(arr, value, max = MAX_HISTORY) {
  const next = [...(arr || []), value];
  return next.slice(-max);
}

function hourBucket() {
  return new Date().getHours();
}

function simpleHash(str) {
  let h = 0;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

exports.recordDelivery = ({ groupId, mediaKey, text, delayMs }) => {
  const data = load();
  data.postHours = pushLimited(data.postHours, hourBucket(), 24);
  if (mediaKey) data.mediaUsed = pushLimited(data.mediaUsed, mediaKey, 20);
  if (text) data.textHashes = pushLimited(data.textHashes, simpleHash(text), 20);
  if (groupId) data.groupSequence = pushLimited(data.groupSequence, groupId, 30);
  if (delayMs) data.lastDelays = pushLimited(data.lastDelays, delayMs, 20);
  save(data);
};

function capPatternExtra(ms) {
  if (!ms || ms <= 0) return 0;
  if (cfg.PATTERN_GUARD_CAP_TO_INTER_GROUP_MAX === false) return ms;
  const max =
    cfg.INTER_GROUP_DELAY_MS_MAX ?? cfg.STATUS_DELAY_MAX ?? 5 * 60 * 1000;
  return Math.min(ms, max);
}

exports.suggestDelayAdjustment = () => {
  const data = load();
  const delays = data.lastDelays || [];
  if (delays.length < 4) return 0;

  const uniq = new Set(delays.map((d) => Math.round(d / 5000) * 5000));
  if (uniq.size <= 2) {
    return capPatternExtra(humanDelay(15000, 45000));
  }
  return 0;
};

exports.shouldRotateMedia = (mediaKey) => {
  const data = load();
  const recent = data.mediaUsed || [];
  if (!mediaKey || recent.length < 3) return false;
  const last3 = recent.slice(-3);
  return last3.every((k) => k === mediaKey);
};

exports.shouldShuffleOrder = (groupIds) => {
  const data = load();
  const seq = data.groupSequence || [];
  if (seq.length < 4 || groupIds.length < 3) return groupIds;

  const tail = seq.slice(-3).join('|');
  const head = groupIds.slice(0, 3).join('|');
  if (tail === head) {
    const shuffled = [...groupIds];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }
  return groupIds;
};

exports.detectHourCluster = () => {
  const data = load();
  const hours = data.postHours || [];
  if (hours.length < 6) return false;
  const last = hours.slice(-6);
  const uniq = new Set(last);
  return uniq.size <= 2;
};

exports.getCooldownSuggestion = () => {
  if (exports.detectHourCluster()) {
    const raw = cfg.PATTERN_GUARD_EXTRA_DELAY_MS ?? humanDelay(120000, 300000);
    return capPatternExtra(raw);
  }
  return 0;
};

module.exports = exports;
