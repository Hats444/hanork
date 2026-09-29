'use strict';

const structured = require('../storage/structuredInviteDb');
const { warningLog } = require('../utils/logger');

function toUrl(code) {
  return `https://chat.whatsapp.com/${String(code || '').trim()}`;
}

function nowMs() {
  return Date.now();
}

function sessionId() {
  return process.env.WA_SESSION_ID || 'wa_a';
}

function db() {
  return structured.catalogDbConn();
}

function normalizeMeta(meta = {}) {
  const copy = { ...meta };
  delete copy.quiet;
  delete copy.resumed;
  delete copy.seed;
  return copy;
}

function buildRecord(code, patch = {}) {
  const t = nowMs();
  const meta = normalizeMeta(patch.meta || patch);
  return {
    code,
    url: toUrl(code),
    subject: patch.subject ?? meta.subject ?? null,
    member_count: Number(patch.member_count ?? patch.size ?? meta.size ?? 0) || 0,
    source_jid: patch.source_jid ?? patch.from ?? meta.from ?? null,
    chat_jid: patch.chat_jid ?? patch.chat ?? meta.chat ?? null,
    native_invite: patch.native_invite ?? meta.native ? 1 : 0,
    status: patch.status || 'detected',
    route_target: patch.route_target ?? null,
    join_session: patch.join_session ?? sessionId(),
    joined_gid: patch.joined_gid ?? null,
    fail_reason: patch.fail_reason ?? null,
    meta_json: Object.keys(meta).length ? JSON.stringify(meta) : null,
    usable: patch.usable == null ? 1 : patch.usable ? 1 : 0,
    received_at: patch.received_at || t,
    last_seen_at: patch.last_seen_at || t,
    joined_at: patch.joined_at ?? null,
  };
}

function upsertSql(record) {
  const conn = db();
  const existing = conn.prepare(`SELECT * FROM wa_invite_links WHERE code = ?`).get(record.code);
  const merged = existing
    ? {
        ...existing,
        ...record,
        received_at: existing.received_at,
        member_count: record.member_count || existing.member_count || 0,
        subject: record.subject || existing.subject,
        joined_gid: record.joined_gid || existing.joined_gid,
        joined_at: record.joined_at || existing.joined_at,
        meta_json: record.meta_json || existing.meta_json,
      }
    : record;

  conn.prepare(
    `INSERT INTO wa_invite_links (
      code, url, subject, member_count, source_jid, chat_jid, native_invite,
      status, route_target, join_session, joined_gid, fail_reason, meta_json,
      usable, received_at, last_seen_at, joined_at
    ) VALUES (
      @code, @url, @subject, @member_count, @source_jid, @chat_jid, @native_invite,
      @status, @route_target, @join_session, @joined_gid, @fail_reason, @meta_json,
      @usable, @received_at, @last_seen_at, @joined_at
    )
    ON CONFLICT(code) DO UPDATE SET
      url = excluded.url,
      subject = COALESCE(excluded.subject, wa_invite_links.subject),
      member_count = CASE WHEN excluded.member_count > 0 THEN excluded.member_count ELSE wa_invite_links.member_count END,
      source_jid = COALESCE(excluded.source_jid, wa_invite_links.source_jid),
      chat_jid = COALESCE(excluded.chat_jid, wa_invite_links.chat_jid),
      native_invite = CASE WHEN excluded.native_invite = 1 THEN 1 ELSE wa_invite_links.native_invite END,
      status = excluded.status,
      route_target = COALESCE(excluded.route_target, wa_invite_links.route_target),
      join_session = COALESCE(excluded.join_session, wa_invite_links.join_session),
      joined_gid = COALESCE(excluded.joined_gid, wa_invite_links.joined_gid),
      fail_reason = COALESCE(excluded.fail_reason, wa_invite_links.fail_reason),
      meta_json = COALESCE(excluded.meta_json, wa_invite_links.meta_json),
      usable = excluded.usable,
      last_seen_at = excluded.last_seen_at,
      joined_at = COALESCE(excluded.joined_at, wa_invite_links.joined_at)`
  ).run(merged);
}

function patch(code, patchData = {}) {
  if (!code) return;
  const record = buildRecord(code, { ...patchData, last_seen_at: nowMs() });
  try {
    upsertSql(record);
  } catch (e) {
    warningLog(`Catálogo convites SQL: ${e?.message || e}`);
  }
}

exports.toUrl = toUrl;
exports.getPath = () => structured.catalogDbPath();

exports.recordDetected = (code, meta = {}) => {
  if (!code) return;
  patch(code, { status: 'detected', meta, join_session: sessionId() });
};

exports.markQueued = (code, meta = {}) => {
  if (!code) return;
  patch(code, { status: 'queued', meta, join_session: sessionId() });
};

exports.markRouted = (code, target = 'wa_b', meta = {}) => {
  if (!code) return;
  patch(code, { status: 'routed', route_target: target, meta, join_session: sessionId() });
};

exports.updatePreview = (code, info = {}) => {
  if (!code) return;
  patch(code, {
    subject: info.subject,
    member_count: info.size ?? info.member_count,
    status: info.status,
  });
};

exports.markJoined = (code, info = {}) => {
  if (!code) return;
  patch(code, {
    status: info.pending ? 'pending_approval' : 'joined',
    joined_gid: info.gid || info.id,
    subject: info.subject,
    member_count: info.size ?? info.member_count,
    joined_at: nowMs(),
    join_session: info.join_session || sessionId(),
    usable: info.pending ? 0 : 1,
  });
};

exports.markFailed = (code, reason = 'failed', meta = {}) => {
  if (!code) return;
  const permanent = /expir|invalid|not.?found|403|410|forbidden/i.test(String(reason));
  patch(code, {
    status: permanent ? 'expired' : 'failed',
    fail_reason: String(reason).slice(0, 240),
    usable: permanent ? 0 : 1,
    meta,
  });
};

exports.markBlocked = (code, reason = 'blocked') => {
  if (!code) return;
  patch(code, { status: 'blocked', fail_reason: reason, usable: 0 });
};

exports.count = () => db().prepare(`SELECT COUNT(*) AS n FROM wa_invite_links`).get()?.n || 0;

exports.countJoinable = () =>
  db()
    .prepare(
      `SELECT COUNT(*) AS n FROM wa_invite_links
       WHERE usable = 1 AND status IN ('detected','queued','routed','failed')`
    )
    .get()?.n || 0;

exports.listJoinable = (limit = 50, offset = 0) => {
  const cap = Math.max(1, Math.min(Number(limit) || 50, 500));
  const off = Math.max(0, Number(offset) || 0);
  const rows = db()
    .prepare(
      `SELECT code, url, subject, member_count, status, received_at, last_seen_at, fail_reason
       FROM wa_invite_links
       WHERE usable = 1 AND status IN ('detected','queued','routed','failed')`
    )
    .all();
  try {
    const { sortJobsByQuality } = require('./inviteJoinScoring');
    const sorted = sortJobsByQuality(
      rows.map((r) => ({
        ...r,
        meta: { subject: r.subject, size: r.member_count, failCount: r.fail_reason ? 1 : 0 },
        at: r.received_at,
      }))
    );
    return sorted.slice(off, off + cap).map(({ code, url, subject, member_count, status, received_at, last_seen_at }) => ({
      code,
      url,
      subject,
      member_count,
      status,
      received_at,
      last_seen_at,
    }));
  } catch {
    return db()
      .prepare(
        `SELECT code, url, subject, member_count, status, received_at, last_seen_at
         FROM wa_invite_links
         WHERE usable = 1 AND status IN ('detected','queued','routed','failed')
         ORDER BY member_count DESC, received_at ASC
         LIMIT ? OFFSET ?`
      )
      .all(cap, off);
  }
};

exports.backfillFromPending = () => {
  try {
    const pending = require('./pendingInvites').list();
    let n = 0;
    for (const item of pending) {
      if (!item.code) continue;
      exports.recordDetected(item.code, { ...item.meta, backfill: true, reason: item.reason });
      n += 1;
    }
    return n;
  } catch {
    return 0;
  }
};

exports.init = () => {
  db();
};

module.exports = exports;
