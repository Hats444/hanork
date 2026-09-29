'use strict';

const fs = require('fs');
const path = require('path');
const cfg = require('../config/divulgacao');
const pathResolver = require('../utils/pathResolver');
const { infoLog, warningLog } = require('../utils/logger');

const SENDER_KEY_RE = /^sender-key-(\d+@g\.us)--/i;
const PRE_KEY_RE = /^pre-key-(\d+)\.json$/i;

const PROTECTED_SESSION = new Set(['creds.json']);

function safeUnlink(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

function walkFiles(dir, onFile) {
  if (!fs.existsSync(dir)) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      walkFiles(full, onFile);
      continue;
    }
    if (ent.isFile()) onFile(full, ent.name);
  }
}

async function getKeepGroupJids(sock) {
  const keep = new Set();
  try {
    const map = await require('./groupCache').getParticipating(sock, false);
    for (const jid of Object.keys(map || {})) {
      if (jid.endsWith('@g.us')) keep.add(jid);
    }
  } catch {
    /* offline — só usa registro local */
  }
  try {
    for (const jid of Object.keys(require('./groupValidator').loadActiveGroups())) {
      if (jid.endsWith('@g.us')) keep.add(jid);
    }
  } catch {
    /* ignore */
  }
  return keep;
}

function pruneJsonMaps(fileName, groupsKey = 'groups') {
  const store = require('../utils/debouncedStore');
  const active = new Set(Object.keys(require('./groupValidator').loadActiveGroups()));
  const invalid = require('./groupValidator').loadInvalidGroups();
  for (const jid of Object.keys(invalid)) active.add(jid);

  let removed = 0;
  store.updateCritical(fileName, (data) => {
    const bucket = data?.[groupsKey];
    if (!bucket || typeof bucket !== 'object') return data;
    for (const jid of Object.keys(bucket)) {
      if (!active.has(jid)) {
        delete bucket[jid];
        removed++;
      }
    }
    return data;
  }, {});
  return removed;
}

exports.pruneBaileysSession = async (sock) => {
  const sessionDir = pathResolver.getSessionDir();
  if (!fs.existsSync(sessionDir)) {
    return { senderKeys: 0, sessions: 0, preKeys: 0, other: 0 };
  }

  const keepGroups = await getKeepGroupJids(sock);
  const staleMs = cfg.SESSION_PRUNE_STALE_MS ?? 21 * 24 * 60 * 60 * 1000;
  const maxSessions = cfg.SESSION_MAX_CONTACT_SESSIONS ?? 350;
  const maxPreKeys = cfg.SESSION_MAX_PREKEYS ?? 60;
  const now = Date.now();

  let senderKeys = 0;
  let sessions = 0;
  let preKeys = 0;
  let other = 0;

  const sessionFiles = [];
  const preKeyFiles = [];

  for (const name of fs.readdirSync(sessionDir)) {
    const full = path.join(sessionDir, name);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;

    if (PROTECTED_SESSION.has(name) || name.startsWith('app-state')) {
      continue;
    }

    if (name.endsWith('.tmp') || /\.bak(\.\d+)?$/.test(name)) {
      if (safeUnlink(full)) other++;
      continue;
    }

    const sk = name.match(SENDER_KEY_RE);
    if (sk) {
      const gid = sk[1];
      if (!keepGroups.has(gid)) {
        if (safeUnlink(full)) senderKeys++;
      }
      continue;
    }

    const pk = name.match(PRE_KEY_RE);
    if (pk) {
      preKeyFiles.push({ full, id: parseInt(pk[1], 10) || 0 });
      continue;
    }

    if (name.startsWith('session-') && name.endsWith('.json')) {
      sessionFiles.push({ full, mtime: stat.mtimeMs });
      continue;
    }

    if (name.startsWith('sender-key-') && safeUnlink(full)) {
      senderKeys++;
    }
  }

  for (const { full, mtime } of sessionFiles) {
    if (now - mtime > staleMs) {
      if (safeUnlink(full)) sessions++;
    }
  }

  if (sessionFiles.length > maxSessions) {
    const sorted = [...sessionFiles].sort((a, b) => a.mtime - b.mtime);
    const excess = sorted.length - maxSessions;
    for (let i = 0; i < excess; i++) {
      if (safeUnlink(sorted[i].full)) sessions++;
    }
  }

  if (preKeyFiles.length > maxPreKeys) {
    preKeyFiles.sort((a, b) => b.id - a.id);
    for (let i = maxPreKeys; i < preKeyFiles.length; i++) {
      if (safeUnlink(preKeyFiles[i].full)) preKeys++;
    }
  }

  return { senderKeys, sessions, preKeys, other };
};

exports.pruneOrphanAndTempFiles = () => {
  const roots = [
    pathResolver.getDatabaseDir(),
    pathResolver.getRuntimeDir(),
    pathResolver.getBackupDir(),
    pathResolver.getTempDir(),
    pathResolver.getLogsDir(),
    path.join(pathResolver.getProjectRoot(), 'database'),
  ];

  let tmp = 0;
  let meta = 0;
  let extraBak = 0;

  for (const root of roots) {
    walkFiles(root, (full, name) => {
      if (/\.(tmp|pid\.\d+\.\d+\.tmp)$/i.test(name) || name.includes('.tmp')) {
        if (safeUnlink(full)) tmp++;
        return;
      }
      if (/\.bak\.[0-9]+$/.test(name)) {
        if (safeUnlink(full)) extraBak++;
        return;
      }
      if (name.endsWith('.meta.json')) {
        const base = full.slice(0, -'.meta.json'.length);
        if (!fs.existsSync(base)) {
          if (safeUnlink(full)) meta++;
        }
      }
    });
  }

  return { tmp, meta, extraBak };
};

exports.pruneQueues = () => {
  const persistentQueue = require('./persistentQueue');
  const maxAge = cfg.DATABASE_QUEUE_MAX_AGE_MS ?? 24 * 60 * 60 * 1000;
  let total = 0;
  for (const name of ['join', 'delivery', 'maintenance', 'cooldown', 'retry']) {
    total += persistentQueue.purgeStale(name, maxAge);
    total += persistentQueue.purgeFailed?.(name, maxAge) || 0;
  }
  try {
    persistentQueue.clearPendingDelivery?.();
  } catch {
    /* ignore */
  }
  return total;
};

exports.pruneForbiddenActive = async (sock) => {
  try {
    return await require('./forbiddenCleanup').purgeForbiddenFromFiles(sock, { skipLeave: true });
  } catch {
    return 0;
  }
};

exports.pruneStateMaps = () => {
  let n = 0;
  n += pruneJsonMaps('schedulerState.json', 'groups');
  n += pruneJsonMaps('groupReputation.json', 'groups');
  n += pruneJsonMaps('groupMetadataCache.json', 'groups');
  try {
    n += require('./groupMetadataCache').pruneStale?.() || 0;
  } catch {
    /* ignore */
  }
  return n;
};

exports.pruneInvalidRegistry = () => {
  const maxAge = cfg.DATABASE_INVALID_MAX_AGE_MS ?? 60 * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - maxAge;
  const store = require('../utils/debouncedStore');
  let removed = 0;

  store.updateCritical('gruposInvalidos.json', (inv) => {
    for (const [jid, meta] of Object.entries(inv)) {
      const at = meta?.at ? new Date(meta.at).getTime() : 0;
      if (at > 0 && at < cutoff) {
        delete inv[jid];
        removed++;
      }
    }
    return inv;
  }, {});

  return removed;
};

exports.pruneDeliveryDedup = () => {
  const store = require('../utils/debouncedStore');
  const max = cfg.DATABASE_DEDUP_MAX_ENTRIES ?? 80;
  let trimmed = 0;
  store.updateCritical('deliveryDedup.json', (data) => {
    const list = Array.isArray(data?.deliveries) ? data.deliveries : [];
    if (list.length <= max) return data;
    trimmed = list.length - max;
    return { ...data, deliveries: list.slice(-max) };
  }, { deliveries: [] });
  return trimmed;
};

exports.pruneRuntimeSnapshots = () => {
  const runtimeDir = pathResolver.getRuntimeDir();
  let removed = 0;
  if (!fs.existsSync(runtimeDir)) return 0;

  for (const name of fs.readdirSync(runtimeDir)) {
    if (name === 'bot.lock') continue;
    if (/\.(bak(\.\d+)?|meta\.json|tmp)$/i.test(name)) {
      if (safeUnlink(path.join(runtimeDir, name))) removed++;
    }
  }
  return removed;
};

exports.run = async (sock) => {
  if (cfg.DATABASE_MAINTENANCE_ENABLED === false) return null;

  const stats = {
    senderKeys: 0,
    sessions: 0,
    preKeys: 0,
    orphan: 0,
    queues: 0,
    maps: 0,
    invalid: 0,
    dedup: 0,
    runtime: 0,
  };

  try {
    const session = await exports.pruneBaileysSession(sock);
    Object.assign(stats, session);
  } catch (e) {
    warningLog(`Limpeza sessão: ${e.message}`);
  }

  try {
    const orphan = exports.pruneOrphanAndTempFiles();
    stats.orphan = (orphan.tmp || 0) + (orphan.meta || 0) + (orphan.extraBak || 0);
  } catch {
    /* ignore */
  }

  try {
    stats.queues = exports.pruneQueues();
  } catch {
    /* ignore */
  }

  try {
    const forbidden = await exports.pruneForbiddenActive(sock);
    if (forbidden > 0) stats.forbidden = forbidden;
  } catch {
    /* ignore */
  }

  try {
    stats.maps = exports.pruneStateMaps();
  } catch {
    /* ignore */
  }

  try {
    stats.invalid = exports.pruneInvalidRegistry();
  } catch {
    /* ignore */
  }

  try {
    stats.dedup = exports.pruneDeliveryDedup();
  } catch {
    /* ignore */
  }

  try {
    stats.runtime = exports.pruneRuntimeSnapshots();
  } catch {
    /* ignore */
  }

  const total =
    stats.senderKeys +
    stats.sessions +
    stats.preKeys +
    stats.orphan +
    stats.queues +
    stats.maps +
    stats.invalid +
    stats.dedup +
    stats.runtime +
    (stats.other || 0);

  if (total > 0) {
    infoLog(
      `Limpeza database: ${total} item(ns) — sessão: ${stats.senderKeys} chaves GP, ${stats.sessions} sessions, ${stats.preKeys} pre-keys · filas: ${stats.queues} · mapas: ${stats.maps}`
    );
  }

  return stats;
};

module.exports = exports;
