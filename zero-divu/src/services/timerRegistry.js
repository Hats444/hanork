'use strict';

const store = require('../utils/debouncedStore');

const FILE = 'timerRegistry.json';

function load() {
  return store.load(FILE, { timers: {}, version: 1 });
}

function save(data) {
  store.setCritical(FILE, data);
}

exports.register = (id, fireAtMs, meta = {}) => {
  const data = load();
  data.timers[id] = {
    id,
    fireAt: new Date(fireAtMs).toISOString(),
    meta,
    updatedAt: new Date().toISOString(),
  };
  save(data);
};

exports.cancel = (id) => {
  const data = load();
  delete data.timers[id];
  save(data);
};

exports.syncFromScheduler = () => {
  try {
    const gs = require('./groupScheduler').loadState();
    const data = load();
    for (const [jid, g] of Object.entries(gs.groups || {})) {
      if (!g.nextPostAt) continue;
      data.timers[`post:${jid}`] = {
        id: `post:${jid}`,
        fireAt: g.nextPostAt,
        meta: { type: 'nextPost', jid },
        updatedAt: new Date().toISOString(),
      };
    }
    save(data);
  } catch {
    /* ignore */
  }
};

exports.getDue = () => {
  const data = load();
  const now = Date.now();
  const due = [];
  for (const t of Object.values(data.timers || {})) {
    if (!t.fireAt) continue;
    if (new Date(t.fireAt).getTime() <= now) due.push(t);
  }
  return due;
};

exports.pruneExpired = (olderThanMs = 48 * 60 * 60 * 1000) => {
  const data = load();
  const cutoff = Date.now() - olderThanMs;
  let pruned = 0;
  for (const [id, t] of Object.entries(data.timers || {})) {
    const at = new Date(t.fireAt).getTime();
    if (at < cutoff) {
      delete data.timers[id];
      pruned++;
    }
  }
  if (pruned) save(data);
  return pruned;
};

exports.load = load;

module.exports = exports;
