'use strict';

const cfg = require('../config/divulgacao');
const limits = require('./operationalLimits');
const { sleep } = require('../utils/sleep');
const store = require('../utils/debouncedStore');
const risk = require('./riskController');

const HOUR_MS = 3600000;

function normalize(s) {
  const out = {
    joinsThisHour: Number(s.joinsThisHour) || 0,
    postsThisHour: Number(s.postsThisHour) || 0,
    hourStarted: Number(s.hourStarted) || Date.now(),
  };
  const now = Date.now();
  if (out.hourStarted > now || now - out.hourStarted > HOUR_MS) {
    out.joinsThisHour = 0;
    out.postsThisHour = 0;
    out.hourStarted = now;
  }
  return out;
}

function state() {
  return normalize(store.load('antiBanState.json', {}));
}

function save(s) {
  store.setCritical('antiBanState.json', normalize(s));
}

function resetHourIfNeeded(s) {
  if (Date.now() - s.hourStarted >= HOUR_MS) {
    s.joinsThisHour = 0;
    s.postsThisHour = 0;
    s.hourStarted = Date.now();
  }
  return s;
}

function fresh() {
  const s = resetHourIfNeeded(state());
  save(s);
  return s;
}

exports.getLimits = () => {
  const s = fresh();
  return {
    joins: s.joinsThisHour,
    posts: s.postsThisHour,
    maxJoins: limits.getMaxJoinsPerHour(),
    maxPosts: limits.getMaxPostsPerHour(),
    warmup: limits.isWarmupActive(),
    hourStarted: s.hourStarted,
  };
};

exports.getMsUntilHourReset = () => {
  const s = fresh();
  return Math.max(0, HOUR_MS - (Date.now() - s.hourStarted));
};

exports.canJoinNow = () => {
  const s = fresh();
  if (!risk.canJoinNow()) return false;
  return s.joinsThisHour < limits.getMaxJoinsPerHour();
};

exports.canPostNow = (opts = {}) => {
  if (opts.bypassRiskPause && (opts.hanorkPromo || opts.manualBlast)) return true;
  const s = fresh();
  if (!opts.bypassRiskPause && !risk.canPostNow()) return false;
  if (opts.bypassRiskPause) return s.postsThisHour < limits.getMaxPostsPerHour();
  return s.postsThisHour < limits.getMaxPostsPerHour();
};

exports.recordJoin = () => {
  const s = fresh();
  s.joinsThisHour++;
  save(s);
  try {
    risk.recordSuccess('join');
  } catch {
    /* ignore */
  }
};

exports.recordPost = () => {
  const s = fresh();
  s.postsThisHour++;
  save(s);
  try {
    risk.recordSuccess('post');
  } catch {
    /* ignore */
  }
};

exports.joinDelay = () => limits.getJoinDelayMs();

exports.postDelay = () => limits.getPostDelayMs();

exports.statusDelay = () => limits.getStatusDelayMs();

exports.withRetry = async (fn, label = 'op') => {
  const { exponentialBackoff } = require('../utils/humanDelay');
  let last;
  for (let i = 0; i < cfg.RETRY_LIMIT; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      try {
        require('./checkpoints').record('before_retry', {
          label,
          attempt: i + 1,
          error: String(e.message || e).slice(0, 80),
        });
      } catch {
        /* ignore */
      }
      const wait = exponentialBackoff(2000, i + 1, { maxMs: 60000 });
      await sleep(wait);
    }
  }
  throw last || new Error(`${label} falhou`);
};
