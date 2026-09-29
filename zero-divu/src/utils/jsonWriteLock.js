'use strict';

const fs = require('fs');
const path = require('path');
const pathResolver = require('./pathResolver');

const LOCK_DIR = pathResolver.getTempDir();
const DEFAULT_TTL_MS = 30 * 1000;
const STALE_MS = 60 * 1000;

function lockPath(name) {
  const safe = String(name).replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join(LOCK_DIR, `${safe}.write.lock`);
}

function readLock(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function isStale(lock) {
  if (!lock?.at) return true;
  const age = Date.now() - new Date(lock.at).getTime();
  if (age > STALE_MS) return true;
  if (lock.expiresAt && Date.now() > new Date(lock.expiresAt).getTime()) return true;
  if (lock.pid) {
    try {
      process.kill(lock.pid, 0);
      return false;
    } catch {
      return true;
    }
  }
  return age > DEFAULT_TTL_MS;
}

exports.acquire = (name, ttlMs = DEFAULT_TTL_MS) => {
  const p = lockPath(name);
  const payload = {
    pid: process.pid,
    at: new Date().toISOString(),
    expiresAt: new Date(Date.now() + ttlMs).toISOString(),
    name,
  };

  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const fd = fs.openSync(p, 'wx');
      fs.writeFileSync(fd, JSON.stringify(payload), 'utf8');
      fs.closeSync(fd);
      return { ok: true, path: p };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const existing = readLock(p);
      if (!existing || isStale(existing)) {
        try {
          fs.unlinkSync(p);
        } catch {
          /* ignore */
        }
        continue;
      }
      const spinUntil = Date.now() + 25;
      while (Date.now() < spinUntil) {
        /* aguarda lock liberar */
      }
    }
  }

  return { ok: false, reason: 'lock-timeout' };
};

exports.release = (name) => {
  const p = lockPath(name);
  try {
    const existing = readLock(p);
    if (existing?.pid === process.pid) fs.unlinkSync(p);
  } catch {
    /* ignore */
  }
};

exports.withLock = (name, fn, ttlMs = DEFAULT_TTL_MS) => {
  const lock = exports.acquire(name, ttlMs);
  if (!lock.ok) throw new Error(`write-lock:${lock.reason}`);
  try {
    return fn();
  } finally {
    exports.release(name);
  }
};

module.exports = exports;
