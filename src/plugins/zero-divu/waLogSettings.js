'use strict';

const { connect } = require('../../config/database-sqlite');

const KV_KEY = 'zero_divu_wa_logs';

function load() {
  try {
    const row = connect().prepare('SELECT value FROM kv_store WHERE key = ?').get(KV_KEY);
    if (!row?.value) return { enabled: false, level: 'info', adminId: null };
    return JSON.parse(row.value);
  } catch {
    return { enabled: false, level: 'info', adminId: null };
  }
}

function save(data) {
  connect()
    .prepare(
      `INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, datetime('now'))`
    )
    .run(KV_KEY, JSON.stringify(data));
}

exports.get = () => load();

exports.setEnabled = (adminId, enabled, level = 'info') => {
  const prev = load();
  const next = {
    enabled: Boolean(enabled),
    level: level === 'warn' ? 'warn' : 'info',
    adminId: enabled ? Number(adminId) : prev.adminId,
  };
  save(next);
  return next;
};

module.exports = exports;
