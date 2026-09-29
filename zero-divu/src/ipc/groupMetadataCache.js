'use strict';

const store = require('../utils/debouncedStore');

const FILE = 'groupMetadataCache.json';
const DEFAULT_TTL = 7 * 24 * 60 * 60 * 1000;

function load() {
  return store.load(FILE, { groups: {} });
}

function save(data) {
  store.setCritical(FILE, data);
}

exports.get = (jid) => {
  const data = load();
  return data.groups[jid] || null;
};

exports.isFresh = (jid, ttlMs = DEFAULT_TTL) => {
  const entry = exports.get(jid);
  if (!entry?.fetchedAt) return false;
  return Date.now() - new Date(entry.fetchedAt).getTime() < ttlMs;
};

exports.remove = (jid) => {
  if (!jid) return false;
  const data = load();
  if (!data.groups[jid]) return false;
  delete data.groups[jid];
  save(data);
  return true;
};

exports.set = (jid, meta = {}) => {
  if (!jid) return;
  const data = load();
  data.groups[jid] = {
    subject: meta.subject || '',
    desc: meta.desc || meta.description || '',
    announce: meta.announce,
    size: meta.size || null,
    fetchedAt: new Date().toISOString(),
  };
  save(data);
};

exports.mergeFromParticipating = (map = {}) => {
  if (!map || typeof map !== 'object') return 0;
  let n = 0;
  const data = load();
  for (const [jid, g] of Object.entries(map)) {
    if (!g) continue;
    const desc = g.desc || g.description || '';
    const subject = g.subject || '';
    if (!desc && !subject) continue;
    const prev = data.groups[jid] || {};
    data.groups[jid] = {
      subject: subject || prev.subject || '',
      desc: desc || prev.desc || '',
      announce: g.announce ?? prev.announce,
      size: g.participants?.length || g.size || prev.size,
      fetchedAt: new Date().toISOString(),
    };
    n++;
  }
  if (n) save(data);
  return n;
};

exports.pruneStale = (maxAgeMs = 14 * 24 * 60 * 60 * 1000) => {
  const active = new Set([
    ...Object.keys(require('./groupValidator').loadActiveGroups()),
    ...Object.keys(require('./groupValidator').loadInvalidGroups()),
  ]);
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  const data = load();
  for (const [jid, entry] of Object.entries(data.groups || {})) {
    const fetched = entry?.fetchedAt ? new Date(entry.fetchedAt).getTime() : 0;
    if (!active.has(jid) || (fetched > 0 && fetched < cutoff)) {
      delete data.groups[jid];
      removed++;
    }
  }
  if (removed) save(data);
  return removed;
};

exports.applyToProfile = (jid, profile) => {
  const cached = exports.get(jid);
  if (!cached) return profile;
  if (!profile.subject && cached.subject) profile.subject = cached.subject;
  if (!profile.desc && cached.desc) profile.desc = cached.desc;
  if (profile.announce === undefined && cached.announce !== undefined) {
    profile.announce = cached.announce;
  }
  if (!profile.size && cached.size) profile.size = cached.size;
  if (cached.desc || cached.subject) profile.metadataFromCache = true;
  return profile;
};

module.exports = exports;
