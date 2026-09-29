'use strict';

/**
 * Cooldown MTProto (ponte): não reentrar no mesmo grupo/link logo após sair.
 */

const logger = require('../config/logger');

const KV_PREFIX = 'bridge_churn:';
/** Mesmo chat (saiu e não reentra de imediato). */
const REJOIN_MS = Number(process.env.BRIDGE_CHURN_REJOIN_MS) || 6 * 60 * 60 * 1000;
/** Mesmo link de convite. */
const LINK_MS = Number(process.env.BRIDGE_CHURN_LINK_MS) || 3 * 60 * 60 * 1000;
/** Tempo mínimo no pool antes de sair só para abrir vaga a grupo maior. */
const VACATE_MIN_MS = Number(process.env.BRIDGE_CHURN_VACATE_MIN_MS) || 2 * 60 * 60 * 1000;

const _logDedupe = new Map();
const LOG_DEDUPE_MS = 30 * 60 * 1000;

function db(dbRaw) {
  return typeof dbRaw === 'function' ? dbRaw() : null;
}

function keyFor(chatId, link) {
  if (chatId) return `${KV_PREFIX}chat:${chatId}`;
  if (link) return `${KV_PREFIX}link:${String(link).trim().slice(0, 200)}`;
  return null;
}

function getRow(dbConn, k) {
  if (!dbConn || !k) return null;
  try {
    const row = dbConn.prepare('SELECT value FROM kv_store WHERE key=?').get(k);
    if (!row?.value) return null;
    return JSON.parse(row.value);
  } catch {
    return null;
  }
}

function setRow(dbConn, k, data) {
  if (!dbConn || !k) return;
  dbConn.prepare(
    `INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, datetime('now'))`
  ).run(k, JSON.stringify({ ...data, at: Date.now() }));
}

function cooldownMsForReason(reason, { forLink = false } = {}) {
  const r = String(reason || '').toLowerCase();
  if (forLink && r.includes('membros_insuficientes')) {
    return Number(process.env.BRIDGE_CHURN_LINK_MEMBROS_MS) || 2 * 60 * 60 * 1000;
  }
  if (
    forLink &&
    (r.includes('sem_permissao') ||
      r.includes('write_forbidden') ||
      r.includes('forbidden'))
  ) {
    return Number(process.env.BRIDGE_CHURN_LINK_FORBIDDEN_MS) || 12 * 60 * 60 * 1000;
  }
  return forLink ? LINK_MS : REJOIN_MS;
}

function gateFromRow(row, defaultMs, now) {
  if (!row?.lastLeaveAt) return { ok: true };
  const ms = row.cooldownMs > 0 ? row.cooldownMs : defaultMs;
  const until = row.lastLeaveAt + ms;
  if (now >= until) return { ok: true };
  return {
    ok: false,
    remainingMin: Math.ceil((until - now) / 60000),
  };
}

function formatWait(remainingMin) {
  const m = Math.max(1, Number(remainingMin) || 1);
  if (m >= 120) {
    const h = m / 60;
    return h >= 10 ? `~${Math.round(h)}h` : `~${h.toFixed(1)}h`;
  }
  return `~${m} min`;
}

exports.recordLeave = (dbRaw, { chatId = null, link = null, reason = '' } = {}) => {
  const conn = db(dbRaw);
  if (!conn) return;
  const payload = {
    lastLeaveAt: Date.now(),
    reason: String(reason || '').slice(0, 80),
  };
  if (chatId) {
    setRow(conn, keyFor(chatId), {
      ...payload,
      cooldownMs: cooldownMsForReason(reason, { forLink: false }),
    });
  }
  if (link) {
    setRow(conn, keyFor(null, link), {
      ...payload,
      cooldownMs: cooldownMsForReason(reason, { forLink: true }),
    });
  }
};

exports.canJoin = (dbRaw, { chatId = null, link = null } = {}) => {
  const conn = db(dbRaw);
  if (!conn) return { ok: true };
  const now = Date.now();

  if (chatId && REJOIN_MS > 0) {
    const row = getRow(conn, keyFor(chatId));
    const gate = gateFromRow(row, REJOIN_MS, now);
    if (!gate.ok) return gate;
  }

  if (link && LINK_MS > 0) {
    const row = getRow(conn, keyFor(null, link));
    const gate = gateFromRow(row, LINK_MS, now);
    if (!gate.ok) return gate;
  }

  return { ok: true };
};

exports.canVacateForUpgrade = (joinedAtMs) => {
  if (VACATE_MIN_MS <= 0) return { ok: true };
  const joined = Number(joinedAtMs) || 0;
  if (joined <= 0) return { ok: true };
  const until = joined + VACATE_MIN_MS;
  if (Date.now() >= until) return { ok: true };
  return {
    ok: false,
    remainingMin: Math.ceil((until - Date.now()) / 60000),
  };
};

exports.logSkip = (title, remainingMin) => {
  const key = String(title || 'grupo');
  const now = Date.now();
  const last = _logDedupe.get(key) || 0;
  if (now - last < LOG_DEDUPE_MS) return;
  _logDedupe.set(key, now);
  logger.info(
    `[BridgePool] Anti-churn: entrada adiada ${formatWait(remainingMin)} — ${key}`
  );
};
