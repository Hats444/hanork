'use strict';

const structured = require('../storage/structuredInviteDb');

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ITEMS = 200;
const LEGACY_FILE = 'pendingInvites.json';

let legacyStore = null;
let migratedLogged = false;

let sqlMode = null;

function useSql() {
  if (sqlMode !== null) return sqlMode;
  const mode = String(process.env.ZERO_DIVU_STORAGE || 'sql').toLowerCase();
  if (mode === 'json') {
    sqlMode = false;
    return false;
  }
  try {
    const jsonDir = require('../utils/pathResolver').getDatabaseDir();
    require('../storage/sqlite').init({ jsonDir });
    require('../storage/sqlite').getDb();
    sqlMode = true;
  } catch {
    sqlMode = false;
  }
  return sqlMode;
}

function getLegacyStore() {
  if (!legacyStore) legacyStore = require('../utils/debouncedStore');
  return legacyStore;
}

function db() {
  try {
    const jsonDir = require('../utils/pathResolver').getDatabaseDir();
    const { db: conn, imported } = structured.initWorkerInvites(jsonDir);
    if (imported > 0 && !migratedLogged) {
      migratedLogged = true;
      try {
        require('../utils/logger').infoLog(
          `Convites pendentes: ${imported} migrado(s) JSON/kv → SQLite`
        );
      } catch {
        /* ignore */
      }
    }
    return conn;
  } catch (e) {
    sqlMode = false;
    throw e;
  }
}

function normalize(entry) {
  const meta = entry.meta && typeof entry.meta === 'object' ? entry.meta : {};
  const inviteSize = Number(entry.inviteSize ?? meta.size ?? meta.inviteSize ?? 0);
  if (inviteSize > 0) meta.size = inviteSize;
  return {
    code: String(entry.code || ''),
    meta,
    inviteSize: inviteSize > 0 ? inviteSize : 0,
    at: entry.at || new Date().toISOString(),
    reason: entry.reason || 'fila',
  };
}

function rowToItem(row) {
  let meta = {};
  if (row.meta_json) {
    try {
      meta = JSON.parse(row.meta_json);
    } catch {
      meta = {};
    }
  }
  return normalize({
    code: row.code,
    meta,
    inviteSize: row.invite_size,
    at: new Date(row.received_at).toISOString(),
    reason: row.reason,
  });
}

function prune(items) {
  const now = Date.now();
  const seen = new Set();
  const out = [];

  for (const raw of items) {
    const item = normalize(raw);
    if (!item.code || seen.has(item.code)) continue;
    const age = now - new Date(item.at).getTime();
    if (age > MAX_AGE_MS) continue;
    seen.add(item.code);
    out.push(item);
  }

  return out.slice(-MAX_ITEMS);
}

function pruneSql(conn) {
  const cutoff = Date.now() - MAX_AGE_MS;
  conn.prepare(`DELETE FROM wa_pending_invites WHERE received_at < ?`).run(cutoff);
  const rows = conn
    .prepare(`SELECT * FROM wa_pending_invites ORDER BY received_at ASC`)
    .all();
  if (rows.length > MAX_ITEMS) {
    const drop = rows.slice(0, rows.length - MAX_ITEMS);
    const del = conn.prepare(`DELETE FROM wa_pending_invites WHERE code = ?`);
    for (const r of drop) del.run(r.code);
  }
}

function legacyLoad() {
  const data = getLegacyStore().load(LEGACY_FILE, { queue: [] });
  if (!Array.isArray(data.queue)) data.queue = [];
  return data;
}

function legacySave(data) {
  getLegacyStore().setCritical(LEGACY_FILE, data);
}

function sqlList() {
  try {
    const conn = db();
    pruneSql(conn);
    return conn
      .prepare(`SELECT * FROM wa_pending_invites ORDER BY received_at ASC`)
      .all()
      .map(rowToItem);
  } catch {
    sqlMode = null;
    return prune(legacyLoad().queue);
  }
}

exports.list = () => {
  if (useSql()) return prune(sqlList());
  return prune(legacyLoad().queue);
};

exports.sortByMemberSize = (queue) => {
  const list = Array.isArray(queue) ? queue.map(normalize) : exports.list();
  return [...list].sort((a, b) => {
    const sa = a.inviteSize || 0;
    const sb = b.inviteSize || 0;
    if (sb !== sa) return sb - sa;
    return new Date(a.at).getTime() - new Date(b.at).getTime();
  });
};

exports.listForProcessing = () => {
  try {
    const { sortJobsByQuality } = require('./inviteJoinScoring');
    return sortJobsByQuality(exports.list());
  } catch {
    return exports.sortByMemberSize(exports.list());
  }
};

exports.has = (code) => exports.list().some((q) => q.code === code);

exports.setInviteSize = (code, size) => {
  const n = Number(size);
  if (!code || !Number.isFinite(n) || n <= 0) return;

  if (useSql()) {
    const conn = db();
    const row = conn.prepare(`SELECT meta_json FROM wa_pending_invites WHERE code = ?`).get(code);
    if (!row) return;
    let meta = {};
    if (row.meta_json) {
      try {
        meta = JSON.parse(row.meta_json);
      } catch {
        meta = {};
      }
    }
    meta.size = n;
    conn.prepare(
      `UPDATE wa_pending_invites SET invite_size = ?, meta_json = ?, updated_at = ? WHERE code = ?`
    ).run(n, JSON.stringify(meta), Date.now(), code);
    return;
  }

  const data = legacyLoad();
  let changed = false;
  data.queue = data.queue.map((raw) => {
    if (raw.code !== code) return raw;
    changed = true;
    return normalize({ ...raw, inviteSize: n, meta: { ...(raw.meta || {}), size: n } });
  });
  if (changed) legacySave(data);
};

exports.add = (code, meta = {}, reason = 'fila') => {
  if (!code) return;
  const inviteSize = Number(meta.size ?? meta.inviteSize ?? 0);
  const item = normalize({ code, meta, reason, inviteSize, at: new Date().toISOString() });

  if (useSql()) {
    try {
      const conn = db();
      conn.prepare(`DELETE FROM wa_pending_invites WHERE code = ?`).run(code);
      structured.insertPendingRow(conn, item);
      pruneSql(conn);
      return;
    } catch {
      sqlMode = null;
    }
  }

  const data = legacyLoad();
  data.queue = prune([
    ...data.queue.filter((q) => q.code !== code),
    item,
  ]);
  legacySave(data);
};

exports.remove = (code) => {
  if (!code) return;

  if (useSql()) {
    db().prepare(`DELETE FROM wa_pending_invites WHERE code = ?`).run(code);
    return;
  }

  const data = legacyLoad();
  const before = data.queue.length;
  data.queue = data.queue.filter((q) => q.code !== code);
  if (data.queue.length !== before) legacySave(data);
};

exports.count = () => exports.list().length;

exports.flush = () => {
  if (useSql()) return;
  getLegacyStore().flush(LEGACY_FILE);
};

exports.usingSql = () => useSql();

module.exports = exports;
