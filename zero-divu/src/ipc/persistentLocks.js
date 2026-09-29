'use strict';

const crypto = require('crypto');
const store = require('../utils/debouncedStore');

const FILE = 'persistentLocks.json';
const DEFAULT_TTL_MS = 15 * 60 * 1000;

function load() {
  return store.load(FILE, { locks: [] });
}

function save(data) {
  store.setCritical(FILE, data);
}

function prune(data) {
  const now = Date.now();
  data.locks = (data.locks || []).filter((l) => new Date(l.expiresAt).getTime() > now);
  return data;
}

exports.acquire = (type, metadata = {}, ttlMs = DEFAULT_TTL_MS) => {
  const data = prune(load());
  const lockId = crypto.randomBytes(6).toString('hex');
  const lock = {
    lockId,
    type,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + ttlMs).toISOString(),
    owner: `pid:${process.pid}`,
    metadata,
  };
  data.locks.push(lock);
  save(data);
  return lock;
};

exports.release = (lockId) => {
  const data = load();
  data.locks = (data.locks || []).filter((l) => l.lockId !== lockId);
  save(data);
};

exports.hasActive = (type, key) => {
  const data = prune(load());
  return data.locks.some(
    (l) =>
      l.type === type &&
      (!key || l.metadata?.key === key) &&
      new Date(l.expiresAt).getTime() > Date.now()
  );
};

exports.listActive = () => prune(load()).locks;

exports.forceClear = () => save({ locks: [] });

exports.releaseOwned = () => {
  const owner = `pid:${process.pid}`;
  const data = load();
  const before = (data.locks || []).length;
  data.locks = (data.locks || []).filter((l) => l.owner !== owner);
  if (data.locks.length !== before) save(data);
};

module.exports = exports;
