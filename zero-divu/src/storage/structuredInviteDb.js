'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const PENDING_META = 'pending_invites_sql_migrated';
const CATALOG_META = 'invite_catalog_sql_migrated';

function resolveBetterSqlite() {
  try {
    return require('better-sqlite3');
  } catch {
    const candidates = [
      path.join(__dirname, '../../node_modules/better-sqlite3'),
      path.join(__dirname, '../../../node_modules/better-sqlite3'),
      path.join(__dirname, '../../../../node_modules/better-sqlite3'),
    ];
    for (const p of candidates) {
      try {
        return require(p);
      } catch {
        /* try next */
      }
    }
    return null;
  }
}

function catalogDbPath() {
  const fromEnv = process.env.ZERO_INVITE_LINKS_DB;
  if (fromEnv && String(fromEnv).trim()) {
    return path.resolve(String(fromEnv).trim());
  }
  return path.join(os.homedir(), '.zero-divu', 'invite-links.db');
}

function ensurePendingSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS wa_pending_invites (
      code TEXT PRIMARY KEY,
      meta_json TEXT,
      invite_size INTEGER NOT NULL DEFAULT 0,
      reason TEXT NOT NULL DEFAULT 'fila',
      received_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_wa_pending_received ON wa_pending_invites(received_at);
  `);
}

function ensureCatalogSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS wa_invite_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      url TEXT NOT NULL,
      subject TEXT,
      member_count INTEGER NOT NULL DEFAULT 0,
      source_jid TEXT,
      chat_jid TEXT,
      native_invite INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'detected',
      route_target TEXT,
      join_session TEXT,
      joined_gid TEXT,
      fail_reason TEXT,
      meta_json TEXT,
      usable INTEGER NOT NULL DEFAULT 1,
      received_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      joined_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_wa_invite_links_status ON wa_invite_links(status);
    CREATE INDEX IF NOT EXISTS idx_wa_invite_links_usable ON wa_invite_links(usable, status);
    CREATE INDEX IF NOT EXISTS idx_wa_invite_links_received ON wa_invite_links(received_at DESC);
  `);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 8000');
}

function workerDb() {
  const sqlite = require('./sqlite');
  sqlite.init({ jsonDir: require('../utils/pathResolver').getDatabaseDir() });
  const db = sqlite.getDb();
  ensurePendingSchema(db);
  return db;
}

let catalogDb = null;

function catalogDbConn() {
  if (catalogDb) return catalogDb;
  const BetterSqlite = resolveBetterSqlite();
  if (!BetterSqlite) throw new Error('better-sqlite3 indisponível para catálogo de convites');
  const dbPath = catalogDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  catalogDb = new BetterSqlite(dbPath);
  ensureCatalogSchema(catalogDb);
  migrateCatalogOnce(catalogDb);
  return catalogDb;
}

function ensureMetaTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
}

function metaDone(db, key) {
  ensureMetaTable(db);
  return db.prepare(`SELECT value FROM meta WHERE key = ?`).get(key)?.value === '1';
}

function metaMark(db, key) {
  ensureMetaTable(db);
  db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, '1')`).run(key);
}

function insertPendingRow(db, item) {
  if (!item?.code) return false;
  const meta = item.meta && typeof item.meta === 'object' ? item.meta : {};
  const inviteSize = Number(item.inviteSize ?? meta.size ?? 0) || 0;
  const atMs = item.at ? new Date(item.at).getTime() : Date.now();
  db.prepare(
    `INSERT OR REPLACE INTO wa_pending_invites
     (code, meta_json, invite_size, reason, received_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    String(item.code),
    Object.keys(meta).length ? JSON.stringify(meta) : null,
    inviteSize,
    item.reason || 'fila',
    atMs,
    Date.now()
  );
  return true;
}

function migratePendingOnce(db, jsonDir) {
  if (metaDone(db, PENDING_META)) return 0;
  let imported = 0;

  db.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);

  try {
    const kvKey = `${sqlite.getKvPrefix() || ''}pendingInvites.json`;
    const row = db.prepare(`SELECT value FROM kv_store WHERE key = ?`).get(kvKey);
    if (row?.value) {
      const data = JSON.parse(row.value);
      for (const item of data.queue || []) {
        if (insertPendingRow(db, item)) imported += 1;
      }
    }
  } catch {
    /* ignore */
  }

  if (jsonDir) {
    const fp = path.join(jsonDir, 'pendingInvites.json');
    if (fs.existsSync(fp)) {
      try {
        const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
        for (const item of data.queue || []) {
          if (insertPendingRow(db, item)) imported += 1;
        }
      } catch {
        /* ignore corrupt */
      }
    }
  }

  metaMark(db, PENDING_META);
  return imported;
}

function insertCatalogRow(db, record) {
  db.prepare(
    `INSERT INTO wa_invite_links (
      code, url, subject, member_count, source_jid, chat_jid, native_invite,
      status, route_target, join_session, joined_gid, fail_reason, meta_json,
      usable, received_at, last_seen_at, joined_at
    ) VALUES (
      @code, @url, @subject, @member_count, @source_jid, @chat_jid, @native_invite,
      @status, @route_target, @join_session, @joined_gid, @fail_reason, @meta_json,
      @usable, @received_at, @last_seen_at, @joined_at
    )
    ON CONFLICT(code) DO NOTHING`
  ).run(record);
}

function migrateCatalogOnce(db) {
  if (metaDone(db, CATALOG_META)) return 0;
  let imported = 0;

  const jsonCandidates = [
    path.join(require('../utils/pathResolver').getDatabaseDir(), 'inviteLinksCatalog.json'),
    path.join(process.cwd(), 'database', 'inviteLinksCatalog.json'),
  ];

  for (const fp of jsonCandidates) {
    if (!fs.existsSync(fp)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
      for (const link of data.links || []) {
        if (!link.code) continue;
        try {
          insertCatalogRow(db, link);
          imported += 1;
        } catch {
          /* duplicate */
        }
      }
    } catch {
      /* ignore */
    }
  }

  metaMark(db, CATALOG_META);
  return imported;
}

function initWorkerInvites(jsonDir) {
  const db = workerDb();
  const imported = migratePendingOnce(db, jsonDir);
  return { db, imported };
}

module.exports = {
  catalogDbPath,
  workerDb,
  catalogDbConn,
  ensurePendingSchema,
  ensureCatalogSchema,
  migratePendingOnce,
  migrateCatalogOnce,
  initWorkerInvites,
  insertPendingRow,
};
