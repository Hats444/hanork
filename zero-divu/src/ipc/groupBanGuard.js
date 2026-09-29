'use strict';

const cfg = require('../config/divulgacao');
const groupProfile = require('./groupProfile');
const groupCache = require('./groupCache');
const groupValidator = require('./groupValidator');
const blacklist = require('./blacklist');
const monitor = require('./monitor');
const { infoLog, warningLog } = require('../utils/logger');

function isRateOrTransient(msg) {
  const s = String(msg || '');
  return /rate-overlimit|overlimit|too many|429|408|tempo esgotado|timed out|connection closed|connection was lost|stream errored|ECONNRESET|offline|WhatsApp offline/i.test(
    s
  );
}

exports.isRateOrTransient = isRateOrTransient;

/** Preview de convite negado por rate limit / sessão — não blacklist permanente */
exports.isTransientInviteError = (msg) => {
  const s = String(msg || '');
  if (isRateOrTransient(s)) return true;
  return /not-authorized|not authorized|unauthorized|401|403|408|429|try again|temporarily|service unavailable|ECONNRESET|preview|indisponível|indisponivel/i.test(
    s
  );
};

/** Link revogado/expirado — pode bloquear convite */
exports.isPermanentInviteError = (msg) => {
  const s = String(msg || '').toLowerCase();
  if (!s) return false;
  if (exports.isTransientInviteError(msg)) return false;
  return /gone|expired|expirado|revoked|revogado|invalid|inválido|not found|404|bad-request|no longer|link.*invalid|invite.*invalid|participant.*add|group.*full|cheio/i.test(
    s
  );
};

exports.isConfirmedRemovedReason = (reason) => {
  const r = String(reason || '').trim().toLowerCase();
  return r === 'bot removido';
};

/** Erro indica ban real — ignora rate limit / rede */
exports.isRealForbiddenError = (msg) => {
  if (isRateOrTransient(msg)) return false;
  return groupProfile.isAccessDeniedError(msg);
};

/** Bot ainda aparece na lista de participantes — limpa blacklist/invalid */
exports.healIfPresentInWhatsApp = async (sock, jid, meta = {}) => {
  if (!jid || !sock) return false;
  let inWa = await groupCache.hasGroup(sock, jid);
  if (!inWa) {
    const live = await groupCache.confirmMembershipLive(sock, jid);
    if (live === true) inWa = true;
    else if (live === null) return false;
  }
  if (!inWa) return false;

  blacklist.unblockGroup(jid);
  groupValidator.clearInvalid(jid);
  groupValidator.registerGroup(jid, {
    ...meta,
    id: jid,
    restoredAt: new Date().toISOString(),
  });
  return true;
};

/** Metadados ao vivo retornam forbidden — não confundir com rate limit */
exports.confirmForbiddenAccess = async (sock, jid) => {
  if (!sock?.groupMetadata || !jid) return false;
  try {
    await sock.groupMetadata(jid);
    return false;
  } catch (e) {
    return exports.isRealForbiddenError(e?.message || String(e));
  }
};

/**
 * Só deve chamar groupLeave quando há evidência forte de ban.
 * Participando na lista = permanece (inclusive entrada manual / re-entrada).
 */
exports.shouldLeaveGroup = async (sock, jid, reason = '', opts = {}) => {
  if (!sock?.groupLeave || !jid) return false;
  if (opts.forceLeave === true) return true;

  let inWa = await groupCache.hasGroup(sock, jid);
  if (!inWa) {
    const live = await groupCache.confirmMembershipLive(sock, jid);
    if (live === true) inWa = true;
    else if (live === null) return false;
    else return false;
  }

  if (opts.bypassBanGuard === true) return true;

  if (exports.isConfirmedRemovedReason(reason)) {
    return false;
  }

  return exports.confirmForbiddenAccess(sock, jid);
};

async function fetchLiveMemberCount(sock, jid) {
  if (!sock?.groupMetadata || !jid) return null;
  try {
    const meta = await sock.groupMetadata(jid);
    const n = Number(meta?.size || meta?.participants?.length || 0);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch (e) {
    if (isRateOrTransient(e?.message || String(e))) return null;
    return null;
  }
}

/**
 * Confirma grupo abaixo do mínimo — evita sair por size=0 ou sync parcial (rate limit).
 */
exports.confirmMemberCountBelow = async (sock, jid, minRequired, reportedSize = 0) => {
  if (!minRequired || minRequired <= 0) return false;
  const reported = Number(reportedSize) || 0;

  if (reported >= minRequired) return false;

  const live = await fetchLiveMemberCount(sock, jid);
  if (live != null) {
    return live > 0 && live < minRequired;
  }

  if (reported <= 0) return false;
  return reported < minRequired;
};

/**
 * Saída segura — política explícita ou ban confirmado; nunca por registro em disco sozinho.
 */
exports.safeLeaveGroup = async (sock, jid, reason, opts = {}) => {
  if (!sock?.groupLeave || !jid) {
    return { left: false, reason: 'no_sock' };
  }

  let inWa = await groupCache.hasGroup(sock, jid);
  if (!inWa) {
    const live = await groupCache.confirmMembershipLive(sock, jid);
    if (live === true) inWa = true;
    else if (live === null) {
      return { left: false, reason: 'membership_unknown' };
    }
  }
  if (!inWa) {
    require('./groupRegistryCleanup').onConfirmedAbsent(
      jid,
      reason || 'já não está no grupo'
    );
    return { left: false, reason: 'not_in_wa', cleaned: true };
  }

  if (!groupCache.isSyncTrustworthy() && !opts.forceLeave) {
    return { left: false, reason: 'sync_partial' };
  }

  if (typeof opts.policyCheck === 'function') {
    const allowed = await opts.policyCheck();
    if (!allowed) {
      return { left: false, reason: 'policy_blocked' };
    }
  }

  const shouldLeave = await exports.shouldLeaveGroup(sock, jid, reason, opts);
  if (!shouldLeave) {
    return { left: false, reason: 'not_confirmed' };
  }

  try {
    const churn = require('./groupChurnGuard');
    const leaveGate = churn.canLeave(jid, reason, opts);
    if (!leaveGate.ok) {
      const short = require('../utils/groupLabels').shortId(jid);
      churn.logBlocked(
        `saída adiada (~${leaveGate.remainingMin} min)`,
        `${short} · ${reason}`,
        `churn-leave-${jid}`
      );
      return { left: false, reason: leaveGate.reason || 'churn_blocked' };
    }
  } catch {
    /* ignore */
  }

  try {
    const active = groupValidator.loadActiveGroups()[jid] || {};
    const inviteCode = active.inviteCode || opts.inviteCode || null;
    await sock.groupLeave(jid);
    monitor.inc('groupsLeft');
    const subject = active.subject || groupValidator.loadActiveGroups()[jid]?.subject;
    try {
      require('./groupChurnGuard').recordLeave(jid, { inviteCode, reason });
    } catch {
      /* ignore */
    }
    require('./groupRegistryCleanup').onBotLeft(jid, reason, {
      blockList: opts.blockList === true,
      subject,
      log: opts.logDrop !== false,
    });
    groupCache.invalidate();
    try {
      require('../ipc/eventBus').emitLeave({
        group: subject || jid.split('@')[0],
        reason: reason || 'policy',
      });
    } catch {
      /* IPC opcional */
    }
    return { left: true };
  } catch (e) {
    return { left: false, reason: e?.message || String(e) };
  }
};

/** Limpa registro local sem blacklist (falso positivo / grupo ausente no sync) */
exports.purgeStaleRegistry = (jid, reason = 'registro obsoleto') => {
  if (!jid) return false;
  require('./groupRegistryCleanup').dropGroup(jid, reason, { blockList: false });
  return true;
};

module.exports = exports;
