'use strict';

const cfg = require('../config/divulgacao');
const pathResolver = require('./pathResolver');
const { writeJsonAtomic, readJsonSafe } = require('./atomicWrite');

const ROOT = pathResolver.getDatabaseDir();
const cache = new Map();
const timers = new Map();

let sql = null;
let useSql = false;

function storageMode() {
  const mode = String(process.env.ZERO_DIVU_STORAGE || 'sql').toLowerCase();
  if (mode === 'json') return 'json';
  return 'sql';
}

function ensureSql() {
  if (sql) return useSql;
  if (storageMode() !== 'sql') return false;
  try {
    sql = require('../storage/sqlite');
    if (!sql.isAvailable()) return false;
    sql.init({ jsonDir: pathResolver.getDatabaseDir() });
    useSql = true;
    return true;
  } catch (e) {
    try {
      require('./logger').warningLog(`SQLite indisponível (${e.message}) — usando JSON`);
    } catch {
      /* ignore */
    }
    useSql = false;
    return false;
  }
}

function filePath(name) {
  return pathResolver.databaseFile(name);
}

function readDisk(name, fallback) {
  if (ensureSql()) {
    return sql.read(name, fallback);
  }
  const p = filePath(name);
  try {
    if (require('fs').existsSync(p)) {
      const raw = require('fs').readFileSync(p, 'utf8');
      const chk = require('./jsonValidator').verifyChecksum(p, raw);
      if (!chk.ok) {
        require('./logger').warningLog(`Checksum inválido em ${name} — restaurando backup`);
      }
      const data = JSON.parse(raw);
      const valid = require('./jsonValidator').validate(name, data);
      if (!valid.ok) throw new Error(`schema:${valid.reason}`);
      return data;
    }
  } catch {
    return readJsonSafe(p, fallback);
  }
  return readJsonSafe(p, fallback);
}

function writeDisk(name, data) {
  if (ensureSql()) {
    sql.write(name, data);
    return;
  }
  const retain = cfg.JSON_BACKUP_RETAIN ?? 3;
  writeJsonAtomic(filePath(name), data, { backup: true, backupRetain: retain });
}

exports.load = (name, fallback = {}) => {
  if (!cache.has(name)) {
    cache.set(name, readDisk(name, fallback));
  }
  return cache.get(name);
};

exports.set = (name, data) => {
  cache.set(name, data);
  if (timers.has(name)) clearTimeout(timers.get(name));
  timers.set(
    name,
    setTimeout(() => {
      writeDisk(name, cache.get(name));
      timers.delete(name);
    }, cfg.JSON_FLUSH_MS || 4000)
  );
};

exports.setCritical = (name, data) => {
  cache.set(name, data);
  if (timers.has(name)) {
    clearTimeout(timers.get(name));
    timers.delete(name);
  }
  writeDisk(name, data);
};

exports.flush = (name) => {
  if (timers.has(name)) {
    clearTimeout(timers.get(name));
    timers.delete(name);
  }
  if (cache.has(name)) writeDisk(name, cache.get(name));
};

exports.update = (name, fn, fallback = {}) => {
  const data = fn(exports.load(name, fallback));
  exports.set(name, data);
  return data;
};

exports.updateCritical = (name, fn, fallback = {}) => {
  const data = fn(exports.load(name, fallback));
  exports.setCritical(name, data);
  return data;
};

exports.flushAll = () => {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  for (const [name, data] of cache.entries()) {
    writeDisk(name, data);
  }
  if (ensureSql()) sql.flushAll();
};

exports.usingSql = () => ensureSql();
exports.getSqlPath = () => (ensureSql() ? sql.getPath() : null);

exports.filePath = filePath;
exports.getRoot = () => ROOT;

module.exports = exports;
