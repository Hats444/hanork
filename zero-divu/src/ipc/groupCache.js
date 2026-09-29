'use strict';

const cfg = require('../config/divulgacao');
const { infoLog, warningLog } = require('../utils/logger');
const logThrottle = require('../utils/logThrottle');
const { sleep } = require('../utils/sleep');
const risk = require('./riskController');

let map = {};
let fetchedAt = 0;
let fetchPromise = null;
let lastLoggedCount = -1;
let lastLogAt = 0;
let lastRateLimitWarnAt = 0;
let lastRateLimitAt = 0;
let lastFetchComplete = true;
let lastWeakConnectionAt = 0;
const liveMembershipCache = new Map();

function isRateLimitError(e) {
  const msg = String(e?.message || e?.output?.payload?.message || e || '');
  return /rate-overlimit|overlimit|too many|429/i.test(msg);
}

function logSyncIfNeeded(count, forced) {
  const verbose = cfg.GROUP_SYNC_VERBOSE === true;
  const now = Date.now();
  const throttleMs = cfg.GROUP_SYNC_LOG_THROTTLE_MS || 15 * 60 * 1000;
  const changed = count !== lastLoggedCount;
  const throttled = now - lastLogAt < throttleMs;

  if (!verbose && !forced && !changed && throttled) return;

  if (changed || verbose || forced || !throttled) {
    infoLog(`Grupos no WhatsApp: ${count}`);
    lastLoggedCount = count;
    lastLogAt = now;
  }
}

exports.getParticipating = async (sock, force = false) => {
  const ttl = cfg.GROUP_SYNC_TTL_MS || 900000;
  if (!force && Date.now() - fetchedAt < ttl && Object.keys(map).length) {
    return map;
  }

  if (fetchPromise) return fetchPromise;

  if (force) {
    infoLog('Sincronizando lista de grupos (WhatsApp)...');
  }

  fetchPromise = (async () => {
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        map = (await sock.groupFetchAllParticipating()) || {};
        fetchedAt = Date.now();
        lastFetchComplete = true;
        lastRateLimitAt = 0;
        try {
          require('./groupMetadataCache').mergeFromParticipating(map);
        } catch {
          /* ignore */
        }
        logSyncIfNeeded(Object.keys(map).length, force);
        fetchPromise = null;
        return map;
      } catch (e) {
        lastErr = e;
        if (isRateLimitError(e)) {
          lastRateLimitAt = Date.now();
          lastFetchComplete = false;
          try {
            risk.recordSignal('wa_rate_limit', e?.message || String(e));
          } catch {
            /* ignore */
          }
          const wait = 15000 * (attempt + 1);
          if (Object.keys(map).length) {
            // Alguns ambientes (WSL/dual-path) podem duplicar module cache; além do throttle
            // global, colocamos um guard local por timestamp.
            const now = Date.now();
            const localOk = now - lastRateLimitWarnAt > 2 * 60 * 1000;
            if (localOk && logThrottle.shouldLog('wa-rate-limit-cache', 2 * 60 * 1000)) {
              warningLog('WhatsApp limitou consultas — usando lista em cache');
              lastRateLimitWarnAt = now;
            }
            fetchPromise = null;
            return map;
          }
          warningLog(`Rate limit WhatsApp — aguardando ${Math.round(wait / 1000)}s…`);
          await sleep(wait);
          continue;
        }
        try {
          risk.recordSignal('wa_unstable', e?.message || String(e));
        } catch {
          /* ignore */
        }
        throw e;
      }
    }
    fetchPromise = null;
    if (Object.keys(map).length) {
      warningLog('Sync de grupos falhou — usando cache anterior');
      return map;
    }
    throw lastErr;
  })();

  try {
    return await fetchPromise;
  } catch (e) {
    fetchPromise = null;
    throw e;
  }
};

exports.hasGroup = async (sock, gid, opts = {}) => {
  if (!gid) return false;
  const groups = await exports.getParticipating(sock, opts.forceSync === true);
  if (groups[gid]) return true;
  if (opts.skipLiveCheck) return false;
  const live = await exports.confirmMembershipLive(sock, gid);
  if (live === true) return true;
  return false;
};

exports.invalidate = () => {
  fetchedAt = 0;
  liveMembershipCache.clear();
};

exports.getMap = () => map;

/** Conexão instável (408, etc.) — não confiar em lista parcial */
exports.markWeakConnection = () => {
  lastWeakConnectionAt = Date.now();
  lastFetchComplete = false;
};

exports.markRateLimited = () => {
  lastRateLimitAt = Date.now();
  lastFetchComplete = false;
};

exports.isSyncTrustworthy = () => {
  const graceMs = cfg.GROUP_SYNC_TRUST_GRACE_MS ?? 5 * 60 * 1000;
  if (lastRateLimitAt && Date.now() - lastRateLimitAt < graceMs) return false;
  if (lastWeakConnectionAt && Date.now() - lastWeakConnectionAt < graceMs) return false;
  if (!lastFetchComplete) return false;

  const waCount = Object.keys(map).filter((k) => k.endsWith('@g.us')).length;
  if (waCount === 0) return false;

  try {
    const diskCount = Object.keys(require('./groupValidator').loadActiveGroups()).length;
    const minRatio = cfg.GROUP_SYNC_MIN_DISK_COVERAGE ?? 0.65;
    if (diskCount >= 4 && waCount < diskCount * minRatio) {
      return false;
    }
  } catch {
    /* ignore */
  }

  return true;
};

/**
 * Confirma membership ao vivo (groupMetadata) — não usa só JSON/cache.
 * @returns {boolean|null} true=in, false=out, null=indeterminado (rate limit)
 */
exports.confirmMembershipLive = async (sock, jid) => {
  if (!jid || !sock?.groupMetadata) return false;
  if (map[jid]) return true;

  const ttl = cfg.GROUP_LIVE_CHECK_TTL_MS ?? 3 * 60 * 1000;
  const cached = liveMembershipCache.get(jid);
  if (cached && Date.now() - cached.at < ttl) return cached.inGroup;

  try {
    await sock.groupMetadata(jid);
    liveMembershipCache.set(jid, { at: Date.now(), inGroup: true });
    return true;
  } catch (e) {
    const msg = e?.message || String(e);
    if (isRateLimitError(e) || /408|connection closed|connection was lost|stream errored|offline/i.test(msg)) {
      try {
        risk.recordSignal('wa_unstable', msg);
      } catch {
        /* ignore */
      }
      return null;
    }
    try {
      if (require('./groupProfile').isAccessDeniedError(msg)) {
        liveMembershipCache.set(jid, { at: Date.now(), inGroup: false });
        return false;
      }
    } catch {
      /* ignore */
    }
    liveMembershipCache.set(jid, { at: Date.now(), inGroup: false });
    return false;
  }
};

exports.countParticipatingGroups = () =>
  Object.keys(map).filter((k) => k.endsWith('@g.us')).length;

exports.getGroup = (jid) => map[jid] || null;
