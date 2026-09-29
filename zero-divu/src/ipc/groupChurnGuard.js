'use strict';

/**
 * Evita loop sair/entrar no mesmo grupo ou convite (spam de membership).
 * Persiste em groupChurnState.json (SQLite/Hanork compartilhado).
 */

const cfg = require('../config/divulgacao');
const store = require('../utils/debouncedStore');
const logThrottle = require('../utils/logThrottle');
const { infoLog } = require('../utils/logger');

const FILE = 'groupChurnState.json';
const MAX_JIDS = 800;
const MAX_INVITES = 2000;

function enabled() {
  return cfg.GROUP_CHURN_GUARD_ENABLED !== false;
}

function rejoinCooldownMs() {
  return Math.max(0, Number(cfg.GROUP_CHURN_REJOIN_COOLDOWN_MS) || 5 * 24 * 60 * 60 * 1000);
}

function inviteCooldownMs() {
  return Math.max(0, Number(cfg.GROUP_CHURN_INVITE_COOLDOWN_MS) || 3 * 24 * 60 * 60 * 1000);
}

function leaveProtectMs() {
  return Math.max(0, Number(cfg.GROUP_CHURN_LEAVE_PROTECT_MS) || 8 * 60 * 60 * 1000);
}

function leaveWindowMs() {
  return Math.max(0, Number(cfg.GROUP_CHURN_LEAVE_WINDOW_MS) || 14 * 24 * 60 * 60 * 1000);
}

function maxLeavesPerJid() {
  return Math.max(1, Number(cfg.GROUP_CHURN_MAX_LEAVES_PER_JID) || 2);
}

function load() {
  return store.load(FILE, { byJid: {}, byInvite: {} });
}

function save(s) {
  store.setCritical(FILE, s);
}

function pruneJid(s, jid) {
  const row = s.byJid[jid];
  if (!row?.leaveHistory?.length) return;
  const cutoff = Date.now() - leaveWindowMs();
  row.leaveHistory = row.leaveHistory.filter((t) => t >= cutoff);
  if (!row.leaveHistory.length && !row.lastJoinAt && !row.lastLeaveAt) {
    delete s.byJid[jid];
  }
}

function pruneState(s) {
  const jids = Object.keys(s.byJid || {});
  if (jids.length > MAX_JIDS) {
    jids
      .sort(
        (a, b) =>
          (s.byJid[a]?.lastLeaveAt || s.byJid[a]?.lastJoinAt || 0) -
          (s.byJid[b]?.lastLeaveAt || s.byJid[b]?.lastJoinAt || 0)
      )
      .slice(0, jids.length - MAX_JIDS)
      .forEach((jid) => delete s.byJid[jid]);
  }
  const invites = Object.keys(s.byInvite || {});
  if (invites.length > MAX_INVITES) {
    invites
      .sort((a, b) => (s.byInvite[a]?.lastAt || 0) - (s.byInvite[b]?.lastAt || 0))
      .slice(0, invites.length - MAX_INVITES)
      .forEach((code) => delete s.byInvite[code]);
  }
}

function remainingMin(untilMs) {
  return Math.max(0, Math.ceil((untilMs - Date.now()) / 60000));
}

const CRITICAL_LEAVE = [
  /ban|blacklist|spam|forbidden|proibid/i,
  /fantasma|ghost|ausente|não está|not_in/i,
  /chat normal|visita única/i,
  /grupo morto|inativo|muitos erros/i,
  /cheio|inválido|expirado/i,
];

function isCriticalLeave(reason) {
  const r = String(reason || '');
  return CRITICAL_LEAVE.some((re) => re.test(r));
}

function isUpgradeLeave(reason) {
  return /substituído|upgrade|grupo maior/i.test(String(reason || ''));
}

function touchInvite(s, code, patch) {
  if (!code) return;
  const c = String(code).trim();
  if (!c) return;
  s.byInvite[c] = { ...(s.byInvite[c] || {}), ...patch, lastAt: Date.now() };
}

function touchJid(s, jid, patch) {
  if (!jid || !jid.endsWith('@g.us')) return;
  s.byJid[jid] = { ...(s.byJid[jid] || {}), ...patch };
}

exports.recordJoin = (jid, { inviteCode = null } = {}) => {
  if (!enabled() || !jid) return;
  const s = load();
  const now = Date.now();
  touchJid(s, jid, { lastJoinAt: now, lastInviteCode: inviteCode || null });
  if (inviteCode) {
    touchInvite(s, inviteCode, { lastJoinAt: now, jid, lastAction: 'join' });
  }
  pruneState(s);
  save(s);
};

exports.recordLeave = (jid, { inviteCode = null, reason = '' } = {}) => {
  if (!enabled() || !jid) return;
  const s = load();
  const now = Date.now();
  const row = s.byJid[jid] || {};
  const history = Array.isArray(row.leaveHistory) ? row.leaveHistory : [];
  history.push(now);
  touchJid(s, jid, {
    lastLeaveAt: now,
    lastLeaveReason: String(reason || '').slice(0, 120),
    lastInviteCode: inviteCode || row.lastInviteCode || null,
    leaveHistory: history,
  });
  if (inviteCode) {
    touchInvite(s, inviteCode, {
      lastLeaveAt: now,
      jid,
      lastAction: 'leave',
      lastReason: String(reason || '').slice(0, 80),
    });
  }
  pruneJid(s, jid);
  pruneState(s);
  save(s);
};

exports.canJoin = (inviteCode, jid = null) => {
  if (!enabled()) return { ok: true };
  const s = load();
  const now = Date.now();
  const rejoinMs = rejoinCooldownMs();
  const invMs = inviteCooldownMs();

  if (inviteCode && invMs > 0) {
    const inv = s.byInvite[String(inviteCode).trim()];
    if (inv?.lastLeaveAt && now - inv.lastLeaveAt < invMs) {
      return {
        ok: false,
        reason: 'churn-convite',
        remainingMin: remainingMin(inv.lastLeaveAt + invMs),
      };
    }
  }

  if (jid && rejoinMs > 0) {
    pruneJid(s, jid);
    const row = s.byJid[jid];
    if (row?.lastLeaveAt && now - row.lastLeaveAt < rejoinMs) {
      return {
        ok: false,
        reason: 'churn-grupo',
        remainingMin: remainingMin(row.lastLeaveAt + rejoinMs),
      };
    }
    if ((row?.leaveHistory?.length || 0) >= maxLeavesPerJid()) {
      const last = row.leaveHistory[row.leaveHistory.length - 1];
      if (last && now - last < rejoinMs) {
        return {
          ok: false,
          reason: 'churn-repetido',
          remainingMin: remainingMin(last + rejoinMs),
        };
      }
    }
  }

  return { ok: true };
};

exports.canVacateForUpgrade = (jid) => {
  if (!enabled() || !jid) return { ok: true };
  const protect = leaveProtectMs();
  if (protect <= 0) return { ok: true };

  const s = load();
  const row = s.byJid[jid];
  const joinedAt = Number(row?.lastJoinAt) || 0;
  if (!joinedAt) return { ok: true };

  const age = Date.now() - joinedAt;
  if (age < protect) {
    return {
      ok: false,
      reason: 'churn-proteção-entrada',
      remainingMin: remainingMin(joinedAt + protect),
    };
  }
  return { ok: true };
};

exports.canLeave = (jid, reason, opts = {}) => {
  if (!enabled() || !jid) return { ok: true };
  if (opts.bypassChurnGuard || opts.forceLeave || isCriticalLeave(reason)) {
    return { ok: true };
  }

  if (isUpgradeLeave(reason)) {
    return exports.canVacateForUpgrade(jid);
  }

  const s = load();
  pruneJid(s, jid);
  const row = s.byJid[jid];
  const history = row?.leaveHistory || [];
  if (history.length >= maxLeavesPerJid()) {
    const last = history[history.length - 1];
    const window = leaveWindowMs();
    if (last && Date.now() - last < window) {
      return {
        ok: false,
        reason: 'churn-muitas-saídas',
        remainingMin: remainingMin(last + window),
      };
    }
  }

  return { ok: true };
};

exports.logBlocked = (kind, detail, throttleKey) => {
  if (!logThrottle.shouldLog(throttleKey || `churn-${kind}`, 15 * 60 * 1000)) return;
  infoLog(`Anti-churn: ${kind}${detail ? ` — ${detail}` : ''}`);
};
