'use strict';

const cfg = require('../config/divulgacao');
const warmup = require('./warmup');
const { humanDelay } = require('../utils/humanDelay');
const risk = require('./riskController');

let statusDelayUseMin = true;

function interGroupBounds() {
  const min =
    cfg.INTER_GROUP_DELAY_MS_MIN ?? cfg.STATUS_DELAY_MIN ?? 60 * 1000;
  const max =
    cfg.INTER_GROUP_DELAY_MS_MAX ?? cfg.STATUS_DELAY_MAX ?? 5 * 60 * 1000;
  return { min, max: Math.max(min, max) };
}

function clampInterGroupDelay(ms) {
  const { min, max } = interGroupBounds();
  return Math.min(max, Math.max(min, Math.round(ms)));
}

/** 0–1: quanto do teto de grupos já está em uso (para frear joins/posts quando cheio). */
function groupFillRatio() {
  try {
    const active = require('./groupValidator').countActive();
    const max = warmup.scaleLimit(cfg.MAX_GROUPS, 'groups', { min: 5 });
    if (!max) return 0;
    return Math.min(1, active / max);
  } catch {
    return 0;
  }
}

function fillThrottleFactor({ start = 0.55, minFactor = 0.55 } = {}) {
  const fill = groupFillRatio();
  if (fill <= start) return 1;
  const t = (fill - start) / (1 - start);
  return 1 - (1 - minFactor) * Math.min(1, t);
}

exports.getGroupFillRatio = () => groupFillRatio();

exports.getProfileId = () => cfg.OPERATION_PROFILE || 'safe';

exports.getProfileLabel = () => cfg.profileLabel || exports.getProfileId();

exports.getMaxGroups = () => warmup.scaleLimit(cfg.MAX_GROUPS, 'groups', { min: 5 });

exports.getMaxPostsPerHour = () => {
  const base = warmup.scaleLimit(cfg.MAX_POSTS_PER_HOUR, 'posts', { min: 5 });
  const throttled = Math.floor(base * fillThrottleFactor({ start: 0.5, minFactor: 0.6 }));
  const rf = risk.getThrottleFactor();
  return Math.max(3, Math.floor(throttled * rf));
};

exports.getMaxJoinsPerHour = () => {
  const base = warmup.scaleLimit(cfg.MAX_JOIN_PER_HOUR, 'joins', { min: 1 });
  const scaled = Math.max(1, Math.floor(base * fillThrottleFactor({ start: 0.45, minFactor: 0.5 })));
  if (groupFillRatio() >= 0.85) return Math.min(scaled, 1);
  if (groupFillRatio() >= 0.7) return Math.min(scaled, 2);
  const rf = risk.getThrottleFactor();
  return Math.max(1, Math.floor(scaled * rf));
};

exports.getMaxGroupsPerCycle = () => {
  const cap = cfg.MAX_GROUPS_PER_CYCLE || 0;
  if (!cap) return 0;
  return warmup.scaleLimit(cap, 'cycle', { min: 3 });
};

exports.getInterGroupDelayMs = (opts = {}) => {
  const { min, max } = interGroupBounds();
  if (max <= min) return min;

  if (opts.forStatus) {
    if (cfg.STATUS_DELAY_ALTERNATE !== false) {
      statusDelayUseMin = !statusDelayUseMin;
      return statusDelayUseMin ? min : max;
    }
    return clampInterGroupDelay(humanDelay(min, max, { skew: 0.35 }));
  }

  let delay = humanDelay(min, max, { skew: 0.35 });
  const fill = groupFillRatio();
  if (fill > 0.5) delay = Math.round(delay * (1 + (fill - 0.5) * 0.8));
  try {
    const rf = risk.getThrottleFactor();
    if (rf < 1) delay = Math.round(delay * (1 + (1 - rf) * 2.2));
    if (risk.isSoftPaused()) delay = Math.round(delay * 1.6);
  } catch {
    /* ignore */
  }
  try {
    const patternGuard = require('./patternGuard');
    const extra = patternGuard.suggestDelayAdjustment();
    if (extra > 0) delay += extra;
    const cooldown = patternGuard.getCooldownSuggestion();
    if (cooldown > 0) delay += cooldown;
    const recovery = require('./runtimeRecovery').getRecoveryDelayFactor();
    delay = Math.round(delay * recovery);
    const quiet = require('../utils/activeHours').getQuietFactor();
    delay = Math.round(delay * quiet);
  } catch {
    /* ignore */
  }
  return clampInterGroupDelay(delay);
};

exports.getStatusDelayMs = () => exports.getInterGroupDelayMs({ forStatus: true });

exports.getPostDelayMs = () =>
  humanDelay(cfg.POST_DELAY_MIN || 10000, cfg.POST_DELAY_MAX || 28000);

exports.getJoinDelayMs = () => {
  let delay = humanDelay(cfg.JOIN_DELAY_MIN || 25000, cfg.JOIN_DELAY_MAX || 90000);
  const fill = groupFillRatio();
  if (fill > 0.4) delay = Math.round(delay * (1 + (fill - 0.4) * 1.2));
  try {
    const rf = risk.getThrottleFactor();
    if (rf < 1) delay = Math.round(delay * (1 + (1 - rf) * 2.5));
    if (risk.isSoftPaused()) delay = Math.round(delay * 1.8);
  } catch {
    /* ignore */
  }
  return delay;
};

exports.getFirstPostDelayMs = () => cfg.FIRST_POST_DELAY_MS ?? 8000;

exports.getWarmupProgress = () => warmup.getProgress();

exports.isWarmupActive = () => warmup.isActive();

exports.snapshot = () => {
  const w = warmup.getProgress();
  const { min, max } = interGroupBounds();
  return {
    profile: exports.getProfileId(),
    profileLabel: exports.getProfileLabel(),
    warmup: w,
    effective: {
      maxGroups: exports.getMaxGroups(),
      groupFillPercent: Math.round(groupFillRatio() * 100),
      maxPostsPerHour: exports.getMaxPostsPerHour(),
      maxJoinsPerHour: exports.getMaxJoinsPerHour(),
      maxGroupsPerCycle: exports.getMaxGroupsPerCycle() || 'todos (sem teto por ciclo)',
      postIntervalMin: Math.round(cfg.POST_INTERVAL / 60000),
      interGroupDelaySec: `${Math.round(min / 1000)}–${Math.round(max / 1000)} (alternado)`,
      minHoursBetweenPostsSameGroup: Math.round(
        (cfg.MIN_GROUP_POST_INTERVAL_MS || 0) / 3600000
      ),
    },
  };
};

module.exports = exports;
