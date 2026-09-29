'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const env = require('../utils/environmentDetector');

let Database = null;
let db = null;
let dbPath = null;
let kvPrefix = '';

const RUNTIME_JSON = new Set([
  'gruposAtivos.json',
  'gruposInvalidos.json',
  'pendingInvites.json',
  'schedulerState.json',
  'queue_join.json',
  'queue_delivery.json',
  'queue_retry.json',
  'queue_maintenance.json',
  'queue_cooldown.json',
  'antiBanState.json',
  'safeMode.json',
  'warmupState.json',
  'rotationState.json',
  'patternGuardState.json',
  'recoveryMode.json',
  'autoProfileState.json',
  'memberAuditState.json',
  'groupReputation.json',
  'groupMetadataCache.json',
  'deliveryDedup.json',
  'status_daily_control.json',
  'status_content_dedup.json',
  'metricsState.json',
  'processHeartbeat.json',
  'processRuntime.json',
  'runtimeSnapshot.json',
  'timerRegistry.json',
  'checkpoints.json',
  'persistentLocks.json',
  'riskState.json',
  'wa_promo_queue.json',
  'stats.json',
  'logs.json',
]);

function resolveBetterSqlite() {
  if (Database) return Database;
  try {
    Database = require('better-sqlite3');
    return Database;
  } catch {
    /* zero-divu pode usar o módulo do Hanork (monorepo) */
  }
  const candidates = [
    path.join(__dirname, '../../../node_modules/better-sqlite3'),
    path.join(__dirname, '../../../../node_modules/better-sqlite3'),
  ];
  for (const p of candidates) {
    try {
      Database = require(p);
      return Database;
    } catch {
      /* try next */
    }
  }
  throw new Error('better-sqlite3 não encontrado — rode npm install no Hanork ou zero-divu');
}

function expandHome(p) {
  const s = String(p || '').trim();
  if (s.startsWith('~/')) return path.join(os.homedir(), s.slice(2));
  if (s === '~') return os.homedir();
  return s;
}

function resolveHanorkDbPath() {
  const fromEnv = process.env.HANORK_DB_PATH || process.env.ZERO_DIVU_DB_PATH;
  if (fromEnv && String(fromEnv).trim()) {
    const p = path.resolve(String(fromEnv).trim());
    if (fs.existsSync(p)) return p;
  }
  const candidates = [
    path.join(__dirname, '../../../hanork.db'),
    path.join(process.cwd(), 'hanork.db'),
    path.join(process.cwd(), '..', 'hanork.db'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return path.resolve(p);
  }
  return path.resolve(path.join(__dirname, '../../../hanork.db'));
}

function useHanorkDb() {
  if (process.env.ZERO_DIVU_USE_HANORK_DB === '1') return true;
  if (process.env.ZERO_DIVU_USE_HANORK_DB === '0') return false;
  const p = process.env.ZERO_DIVU_DB_PATH || process.env.HANORK_DB_PATH || '';
  return /hanork\.db$/i.test(String(p).trim());
}

function defaultDbPath() {
  const fromEnv = expandHome(process.env.ZERO_DIVU_DB_PATH);
  if (fromEnv && String(fromEnv).trim()) return path.resolve(String(fromEnv).trim());

  if (useHanorkDb()) return resolveHanorkDbPath();

  const cwd = process.cwd();
  const onWslMount = /^\/mnt\/[a-z]\//i.test(cwd) || cwd.includes('\\');
  if (onWslMount || env.get().isWsl) {
    return path.join(os.homedir(), '.zero-divu', 'zero-divu.db');
  }
  return path.join(cwd, 'database', 'zero-divu.db');
}

function legacyZeroDbPath() {
  const cwd = process.cwd();
  const onWslMount = /^\/mnt\/[a-z]\//i.test(cwd) || cwd.includes('\\');
  if (onWslMount || env.get().isWsl) {
    return path.join(os.homedir(), '.zero-divu', 'zero-divu.db');
  }
  return path.join(cwd, 'database', 'zero-divu.db');
}

function storageKey(key) {
  if (!kvPrefix) return key;
  if (String(key).startsWith(kvPrefix)) return key;
  return `${kvPrefix}${key}`;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS kv_store (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
    );
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  try {
    require('./structuredInviteDb').ensurePendingSchema(db);
  } catch {
    /* ignore */
  }
  const onDrvfs = /\/mnt\/[a-z]\//i.test(String(dbPath || '').replace(/\\/g, '/'));
  const forced = String(process.env.SQLITE_JOURNAL_MODE || '').trim().toUpperCase();
  const primary = forced || (onDrvfs ? 'DELETE' : 'WAL');
  const modes = primary === 'WAL' ? ['WAL', 'DELETE'] : [primary, 'DELETE'];
  let applied = false;
  for (const mode of modes) {
    try {
      db.pragma(`journal_mode = ${mode}`);
      applied = true;
      break;
    } catch {
      /* try fallback */
    }
  }
  if (!applied) throw new Error(`SQLite: journal_mode falhou em ${dbPath}`);
  if (onDrvfs || primary === 'DELETE') {
    for (const ext of ['-wal', '-shm']) {
      try {
        const sidecar = `${path.resolve(dbPath)}${ext}`;
        if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
      } catch {
        /* ignore */
      }
    }
  }
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 8000');
}

function migrateJsonDir(jsonDir) {
  const metaKey = kvPrefix ? 'zd_json_migrated_v2' : 'json_migrated_v1';
  const done = db.prepare(`SELECT value FROM meta WHERE key = ?`).get(metaKey);
  if (done?.value === '1') return { skipped: true, imported: 0 };

  let imported = 0;
  if (!fs.existsSync(jsonDir)) {
    db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, '1')`).run(metaKey);
    return { skipped: false, imported: 0 };
  }

  const insert = db.prepare(
    `INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, ?)`
  );
  const migrate = db.transaction((files) => {
    for (const name of files) {
      const fp = path.join(jsonDir, name);
      if (!fs.existsSync(fp)) continue;
      try {
        const raw = fs.readFileSync(fp, 'utf8');
        JSON.parse(raw);
        insert.run(storageKey(name), raw, Date.now());
        imported++;
      } catch {
        /* ignore corrupt */
      }
    }
  });

  const files = fs.readdirSync(jsonDir).filter((f) => f.endsWith('.json') && RUNTIME_JSON.has(f));
  migrate(files);
  db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, '1')`).run(metaKey);
  return { skipped: false, imported };
}

function migrateLegacyZeroDb(legacyPath) {
  if (!kvPrefix) return { imported: 0 };
  const metaKey = 'zd_legacy_db_migrated';
  const done = db.prepare(`SELECT value FROM meta WHERE key = ?`).get(metaKey);
  if (done?.value === '1') return { skipped: true, imported: 0 };
  if (!legacyPath || !fs.existsSync(legacyPath)) {
    db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, '1')`).run(metaKey);
    return { skipped: false, imported: 0 };
  }
  if (path.resolve(legacyPath) === path.resolve(dbPath)) {
    db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, '1')`).run(metaKey);
    return { skipped: true, imported: 0 };
  }

  let imported = 0;
  try {
    const BetterSqlite = resolveBetterSqlite();
    const legacy = new BetterSqlite(legacyPath, { readonly: true });
    const rows = legacy.prepare(`SELECT key, value, updated_at FROM kv_store`).all();
    legacy.close();
    const insert = db.prepare(
      `INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, ?)`
    );
    const tx = db.transaction((items) => {
      for (const row of items) {
        const sk = storageKey(row.key);
        const exists = db.prepare(`SELECT 1 FROM kv_store WHERE key = ?`).get(sk);
        if (exists) continue;
        insert.run(sk, row.value, row.updated_at || Date.now());
        imported++;
      }
    });
    tx(rows);
  } catch {
    /* legacy db unreadable */
  }
  db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, '1')`).run(metaKey);
  return { skipped: false, imported };
}

exports.isAvailable = () => {
  try {
    resolveBetterSqlite();
    return true;
  } catch {
    return false;
  }
};

exports.getPath = () => dbPath;
exports.getKvPrefix = () => kvPrefix;
exports.getDb = () => {
  if (!db) exports.connect();
  return db;
};

exports.connect = (opts = {}) => {
  if (db) return db;
  const BetterSqlite = resolveBetterSqlite();
  dbPath = opts.path || defaultDbPath();
  kvPrefix = useHanorkDb() || /hanork\.db$/i.test(dbPath) ? 'zd:' : '';
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new BetterSqlite(dbPath);
  initSchema();
  return db;
};

exports.init = (opts = {}) => {
  exports.connect(opts);
  const jsonDir = opts.jsonDir;
  let totalImported = 0;
  if (jsonDir) {
    const r = migrateJsonDir(jsonDir);
    totalImported += r.imported || 0;
    try {
      const pi = require('./structuredInviteDb').migratePendingOnce(db, jsonDir);
      if (pi > 0) totalImported += pi;
    } catch {
      /* ignore */
    }
  }
  if (kvPrefix) {
    const lr = migrateLegacyZeroDb(legacyZeroDbPath());
    totalImported += lr.imported || 0;
  }
  if (totalImported > 0) {
    try {
      require('../utils/logger').successLog(
        `SQLite: ${totalImported} registro(s) migrado(s) → ${dbPath}${kvPrefix ? ' (prefixo zd:)' : ''}`
      );
    } catch {
      /* ignore */
    }
  }
  return db;
};

exports.read = (key, fallback) => {
  if (!db) exports.connect();
  const row = db.prepare(`SELECT value FROM kv_store WHERE key = ?`).get(storageKey(key));
  if (!row?.value) return fallback;
  try {
    return JSON.parse(row.value);
  } catch {
    return fallback;
  }
};

exports.write = (key, data) => {
  if (!db) exports.connect();
  const value = JSON.stringify(data);
  db.prepare(
    `INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, ?)`
  ).run(storageKey(key), value, Date.now());
};

exports.delete = (key) => {
  if (!db) exports.connect();
  db.prepare(`DELETE FROM kv_store WHERE key = ?`).run(storageKey(key));
};

exports.flushAll = () => {
  /* WAL já persiste; noop para compat */
};

exports.close = () => {
  if (db) {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    db = null;
  }
};

module.exports = exports;
