'use strict';

const groupValidator = require('./groupValidator');
const groupCache = require('./groupCache');
const pendingInvites = require('./pendingInvites');
const store = require('../utils/debouncedStore');

function registryLabel() {
  try {
    return store.usingSql?.() ? 'banco' : 'disco';
  } catch {
    return 'registro';
  }
}

/** Resumo WA vs registro persistido (SQLite ou JSON legado). */
exports.getSnapshot = () => {
  const disk = groupValidator.countActive();
  let wa = 0;
  let trustworthy = false;
  try {
    trustworthy = groupCache.isSyncTrustworthy();
    wa = groupCache.countParticipatingGroups();
  } catch {
    /* ignore */
  }

  const partial = disk > 0 && wa > 0 && disk > wa + 2;
  const inviteQueue = pendingInvites.count();

  return {
    diskActive: disk,
    waGroups: wa,
    syncTrustworthy: trustworthy,
    syncPartial: partial && !trustworthy,
    ghostSuspect: partial,
    inviteQueue,
    at: new Date().toISOString(),
  };
};

exports.describe = () => {
  const s = exports.getSnapshot();
  const reg = registryLabel();
  if (!s.syncTrustworthy) {
    return `Sync parcial — ${reg}: ${s.diskActive} · WA: ${s.waGroups || '?'} (não limpa registro até confirmar)`;
  }
  if (s.ghostSuspect) {
    return `${reg}: ${s.diskActive} · WA: ${s.waGroups} — reconciliando fantasmas`;
  }
  return `Grupos alinhados — ${reg}: ${s.diskActive} · WA: ${s.waGroups}`;
};

module.exports = exports;
