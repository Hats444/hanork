'use strict';

const cfg = require('../config/divulgacao');
const metadataCache = require('./groupMetadataCache');
const { sleep } = require('../utils/sleep');
const logThrottle = require('../utils/logThrottle');
const { infoLog, warningLog } = require('../utils/logger');

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('tempo esgotado')), ms);
  });
  try {
    return Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function descLength(profile) {
  return String(profile.desc || profile.description || '').trim().length;
}

function isConnectionError(msg) {
  return /connection closed|connection was lost|socket indispon|stream errored|conflict/i.test(
    String(msg || '')
  );
}

function isAccessDeniedError(msg) {
  if (require('./groupBanGuard').isRateOrTransient(msg)) return false;
  return /forbidden|not-authorized|not authorized|403/i.test(String(msg || ''));
}

exports.isAccessDeniedError = isAccessDeniedError;

exports.isSocketOnline = (sock) => {
  try {
    return require('./socketRegistry').isOnline(sock);
  } catch {
    return Boolean(sock?.user?.id);
  }
};

function enrichFromSources(profile, jid, hints = {}) {
  try {
    const wa = require('./groupCache').getMap()[jid];
    if (wa) {
      if (!profile.subject && wa.subject) profile.subject = wa.subject;
      if (!profile.desc && wa.desc) profile.desc = wa.desc;
      if (profile.announce === undefined && wa.announce !== undefined) {
        profile.announce = wa.announce;
      }
      if (!profile.size) profile.size = wa.participants?.length || wa.size;
      if (profile.desc || profile.subject) profile.metadataFromSync = true;
    }
  } catch {
    /* ignore */
  }

  metadataCache.applyToProfile(jid, profile);

  if (hints.subject && !profile.subject) profile.subject = hints.subject;
  if ((hints.desc || hints.description) && !profile.desc) {
    profile.desc = hints.desc || hints.description;
  }
  if (hints.announce !== undefined && profile.announce === undefined) {
    profile.announce = hints.announce;
  }
  if (hints.size && !profile.size) profile.size = hints.size;

  profile.metadataComplete = descLength(profile) >= 12;
  return profile;
}

async function fetchLive(sock, jid, profile) {
  const timeout = cfg.GROUP_METADATA_TIMEOUT_MS || 20000;
  const retries = cfg.GROUP_METADATA_RETRIES ?? 2;
  const retryMs = cfg.GROUP_METADATA_RETRY_MS ?? 3000;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (!exports.isSocketOnline(sock)) {
      throw new Error('WhatsApp offline');
    }

    try {
      const meta = await withTimeout(sock.groupMetadata(jid), timeout);
      if (!meta) return profile;

      profile.metadataFetched = true;
      profile.metadataSource = 'live';
      profile.subject = meta.subject || profile.subject;
      profile.desc = meta.desc || profile.desc;
      profile.announce = meta.announce ?? profile.announce;
      profile.size = meta.size || meta.participants?.length || profile.size;
      profile.isCommunity = meta.isCommunity;
      profile.isCommunityAnnounce = meta.isCommunityAnnounce;
      profile.metadataComplete = descLength(profile) >= 12;
      profile.metadataError = null;

      metadataCache.set(jid, profile);
      return profile;
    } catch (e) {
      profile.metadataError = e.message || String(e);
      if (isConnectionError(profile.metadataError) && attempt < retries) {
        await sleep(retryMs * (attempt + 1));
        continue;
      }
      throw e;
    }
  }

  return profile;
}

/**
 * Coleta perfil do grupo — prioridade: hints/disco → cache sync → cache disco → fetch live (se online)
 */
exports.collect = async (sock, jid, hints = {}, opts = {}) => {
  const profile = {
    id: jid,
    subject: hints.subject || hints.groupName || '',
    desc: hints.desc || hints.description || '',
    announce: hints.announce,
    size: hints.size,
    inviteText: hints.inviteText || '',
    isCommunity: hints.isCommunity,
    isCommunityAnnounce: hints.isCommunityAnnounce,
    metadataFetched: false,
    metadataComplete: false,
    metadataError: null,
    metadataSource: 'hints',
  };

  enrichFromSources(profile, jid, hints);

  if (!cfg.ENABLE_GROUP_CLASSIFIER) return profile;

  const cacheTtl = cfg.GROUP_METADATA_CACHE_TTL_MS ?? 6 * 60 * 60 * 1000;
  const cacheFresh = metadataCache.isFresh(jid, cacheTtl);
  const forceFetch = opts.forceFetch === true;
  /** Live só se falta descrição — announce/subject vêm do cache/sync */
  const needsLive = forceFetch || (!cacheFresh && !profile.metadataComplete);

  if (!needsLive || !sock?.groupMetadata || !jid) {
    if (profile.metadataComplete) profile.metadataSource = profile.metadataFromSync ? 'sync' : 'cache';
    return profile;
  }

  if (!exports.isSocketOnline(sock)) {
    profile.metadataSource = profile.metadataComplete ? 'cache-offline' : 'offline-incomplete';
    if (!profile.metadataComplete && logThrottle.shouldLog('meta-offline', 120000)) {
      infoLog('Metadados: WhatsApp offline — usando descrição em cache/disco');
    }
    return profile;
  }

  try {
    return await fetchLive(sock, jid, profile);
  } catch (e) {
    profile.metadataError = e.message || String(e);
    enrichFromSources(profile, jid, hints);

    if (profile.metadataComplete) {
      profile.metadataSource = isAccessDeniedError(profile.metadataError)
        ? 'cache-forbidden'
        : 'cache-fallback';
      if (logThrottle.shouldLog(`meta-fallback-${String(jid).slice(0, 10)}`, 300000)) {
        const note = isAccessDeniedError(profile.metadataError)
          ? 'descrição em cache (WhatsApp negou leitura ao vivo)'
          : profile.metadataError;
        infoLog(`Metadados live falharam (${String(jid).split('@')[0]}) — ${note}`);
      }
      return profile;
    }

    if (isAccessDeniedError(profile.metadataError)) {
      if (require('./groupBanGuard').isRateOrTransient(profile.metadataError)) {
        return profile;
      }
      setImmediate(() => {
        try {
          const sock = require('./socketRegistry').get();
          require('./forbiddenCleanup').onForbiddenDetected(sock, jid, profile.metadataError);
        } catch {
          /* ignore */
        }
      });
      return profile;
    }

    if (logThrottle.shouldLog(`meta-fail-${String(jid).slice(0, 12)}`, 180000)) {
      warningLog(`Metadados indisponíveis (${String(jid).split('@')[0]}): ${profile.metadataError}`);
    }
    return profile;
  }
};

exports.hasUsableDescription = (profile, active) => {
  if (profile?.metadataComplete) return true;
  if (active?.desc && String(active.desc).length >= 12) return true;
  if (profile?.desc && String(profile.desc).length >= 12) return true;
  return false;
};

module.exports = exports;
