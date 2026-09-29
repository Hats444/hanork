'use strict';

const cfg = require('../config/divulgacao');
const store = require('../utils/debouncedStore');
const groupValidator = require('./groupValidator');
const groupCache = require('./groupCache');
const groupBanGuard = require('./groupBanGuard');
const groupQuality = require('./groupQuality');
const monitor = require('./monitor');
const { infoLog, warningLog, successLog } = require('../utils/logger');

const AUDIT_STATE_FILE = 'memberAuditState.json';

function minMembers() {
  return Math.max(0, Number(cfg.MIN_MEMBERS_IN_GROUP) || 50);
}

function skipSmallGroupLeave(group) {
  try {
    const { isProtectedGroup } = require('../utils/manualJoinPolicy');
    return isProtectedGroup(group);
  } catch {
    return Boolean(group?.manualJoin);
  }
}

function upgradeMinGain() {
  return Math.max(5, Number(cfg.GROUP_UPGRADE_MIN_MEMBER_GAIN) || 20);
}

/** Tamanho ao vivo (metadata) — null se indeterminado */
async function fetchLiveMemberCount(sock, jid) {
  if (!sock?.groupMetadata || !jid) return null;
  try {
    const meta = await sock.groupMetadata(jid);
    const n = Number(meta?.size || meta?.participants?.length || 0);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch (e) {
    if (groupBanGuard.isRateOrTransient(e?.message || String(e))) return null;
    return null;
  }
}

exports.getMemberCount = async (sock, jid, hints = {}) => {
  const reported = Number(hints.size ?? hints.participants?.length ?? 0);
  const live = await fetchLiveMemberCount(sock, jid);
  if (live != null) return live;
  return reported > 0 ? reported : 0;
};

exports.isBelowMinMembers = (count) => {
  const min = minMembers();
  if (min <= 0) return false;
  return count > 0 && count < min;
};

/** Confirma que o bot está no grupo de verdade (não fantasma no JSON) */
exports.confirmRealMembership = async (sock, jid) => {
  if (!jid) return { inGroup: false, reason: 'no_jid' };
  const live = await groupCache.confirmMembershipLive(sock, jid);
  if (live === true) return { inGroup: true };
  if (live === false) return { inGroup: false, reason: 'not_in_wa' };
  return { inGroup: null, reason: 'sync_uncertain' };
};

function auditTargets() {
  const active = groupValidator.loadActiveGroups();
  return Object.entries(active)
    .filter(([, g]) => g.groupType !== 'chat' && !g.visitOnly && !g.pendingApproval)
    .map(([jid]) => jid);
}

function loadAuditCursor() {
  const s = store.load(AUDIT_STATE_FILE, { cursor: 0, lastRunAt: null });
  return { cursor: Number(s.cursor) || 0, lastRunAt: s.lastRunAt || null };
}

function saveAuditCursor(cursor) {
  store.setCritical(AUDIT_STATE_FILE, {
    cursor,
    lastRunAt: new Date().toISOString(),
  });
}

/**
 * Lote de auditoria (produção) — evita rajada de groupMetadata no sync.
 */
exports.auditNextBatch = async (sock) => {
  if (!sock || !groupCache.isSyncTrustworthy()) {
    return { left: 0, dropped: 0, updated: 0, uncertain: 0, skipped: true };
  }

  const batchGap = cfg.MEMBER_AUDIT_BATCH_GAP_MS ?? 10 * 60 * 1000;
  const { cursor, lastRunAt } = loadAuditCursor();
  if (lastRunAt && Date.now() - new Date(lastRunAt).getTime() < batchGap) {
    return { left: 0, dropped: 0, updated: 0, uncertain: 0, skipped: true };
  }

  const jids = auditTargets();
  if (!jids.length) return { left: 0, dropped: 0, updated: 0, uncertain: 0 };

  const batchSize = Math.max(1, Number(cfg.MEMBER_AUDIT_BATCH_SIZE) || 5);
  const start = cursor % jids.length;
  const slice = [];
  for (let i = 0; i < batchSize; i++) {
    slice.push(jids[(start + i) % jids.length]);
  }
  saveAuditCursor(start + batchSize);

  let left = 0;
  let dropped = 0;
  let updated = 0;
  let uncertain = 0;
  const min = minMembers();
  const drop = require('./groupRegistryCleanup');

  for (const jid of slice) {
    const g = groupValidator.loadActiveGroups()[jid] || {};
    const mem = await exports.getMemberCount(sock, jid, g);
    const confirm = await exports.confirmRealMembership(sock, jid);

    if (confirm.inGroup === false) {
      drop.onConfirmedAbsent(jid);
      dropped++;
      monitor.inc('ghostsRemoved');
      continue;
    }
    if (confirm.inGroup === null) {
      uncertain++;
      continue;
    }
    if (mem > 0 && mem !== g.size) {
      groupValidator.registerGroup(jid, { size: mem, memberCheckedAt: new Date().toISOString() });
      updated++;
    }
    if (min > 0 && mem > 0 && mem < min) {
      if (skipSmallGroupLeave(g)) {
        updated++;
        continue;
      }
      warningLog(
        `Grupo pequeno (${mem} < ${min}): ${g.subject || jid.split('@')[0]} — saindo`
      );
      const out = await groupBanGuard.safeLeaveGroup(sock, jid, `poucos membros (${mem})`, {
        bypassBanGuard: true,
        policyCheck: async () => true,
      });
      if (out.left) {
        left++;
        monitor.inc('leftSmallGroup');
      }
    }
  }

  if (left || dropped || updated) {
    infoLog(
      `Auditoria (lote ${slice.length}): ${updated} atualizado(s) · ${left} saída(s) · ${dropped} fantasma(s)`
    );
  }

  return { left, dropped, updated, uncertain, batch: slice.length };
};

/**
 * Avalia todos os grupos ativos (uso manual / manutenção).
 */
exports.auditActiveGroups = async (sock) => {
  if (!sock) return { left: 0, dropped: 0, updated: 0, uncertain: 0 };

  const active = groupValidator.loadActiveGroups();
  const min = minMembers();
  let left = 0;
  let dropped = 0;
  let updated = 0;
  let uncertain = 0;
  const drop = require('./groupRegistryCleanup');

  for (const [jid, g] of Object.entries(active)) {
    if (g.groupType === 'chat' || g.visitOnly || g.pendingApproval) continue;

    const mem = await exports.getMemberCount(sock, jid, g);
    const confirm = await exports.confirmRealMembership(sock, jid);

    if (confirm.inGroup === false) {
      drop.onConfirmedAbsent(jid);
      dropped++;
      continue;
    }

    if (confirm.inGroup === null) {
      uncertain++;
      continue;
    }

    if (mem > 0 && mem !== g.size) {
      groupValidator.registerGroup(jid, { size: mem, memberCheckedAt: new Date().toISOString() });
      updated++;
    }

    if (min > 0 && mem > 0 && mem < min) {
      if (skipSmallGroupLeave(g)) {
        updated++;
        continue;
      }
      warningLog(
        `Grupo pequeno (${mem} < ${min}): ${g.subject || jid.split('@')[0]} — saindo`
      );
      const out = await groupBanGuard.safeLeaveGroup(sock, jid, `poucos membros (${mem})`, {
        bypassBanGuard: true,
        policyCheck: async () => true,
      });
      if (out.left) left++;
    }
  }

  if (left || dropped || updated) {
    infoLog(
      `Auditoria membros: ${updated} atualizado(s) · ${left} saída(s) · ${dropped} fantasma(s) removido(s)`
    );
  }

  return { left, dropped, updated, uncertain };
};

/** Pior grupo onde ainda pode divulgar — candidato a saída só com upgrade melhor */
exports.pickSmallestActiveGroup = async (sock) => {
  const active = groupValidator.loadActiveGroups();
  const candidates = [];

  for (const [jid, g] of Object.entries(active)) {
    if (g.pendingApproval || g.groupType === 'chat' || g.visitOnly) continue;
    if (require('./blacklist').isGroupBlocked(jid)) continue;
    if (!groupQuality.canDivulgeInGroup(g)) continue;

    const confirm = await exports.confirmRealMembership(sock, jid);
    if (confirm.inGroup !== true) continue;

    const mem = await exports.getMemberCount(sock, jid, g);
    if (mem <= 0) continue;
    const record = { ...g, id: jid, size: mem };
    candidates.push({
      id: jid,
      subject: g.subject,
      size: mem,
      score: g.score ?? 0,
      ranking: groupQuality.groupRankingScore(record, mem),
      _record: record,
    });
  }

  if (!candidates.length) return null;
  // Pior = menos membros; empate desempata por score/ranking
  candidates.sort((a, b) => a.size - b.size || a.ranking - b.ranking);
  return candidates[0];
};

/**
 * No limite de vagas: se o convite tem bem mais membros que o menor grupo, sai do menor e libera vaga.
 * @returns {'joined'|'skip'|'no_upgrade'|'uncertain'}
 */
exports.tryUpgradeForInvite = async (sock, inviteInfo, meta = {}) => {
  if (cfg.ENABLE_GROUP_UPGRADE_BY_MEMBERS === false) return 'no_upgrade';
  if (!sock || !inviteInfo?.id) return 'no_upgrade';
  if (!groupCache.isSyncTrustworthy()) return 'uncertain';

  const inviteSize = Number(inviteInfo.size || 0);
  const min = minMembers();
  if (inviteSize > 0 && inviteSize < min) {
    warningLog(
      `Convite rejeitado (${inviteSize} membros < ${min}): ${inviteInfo.subject || inviteInfo.id}`
    );
    return 'skip';
  }

  const weakest = await exports.pickSmallestActiveGroup(sock);
  if (!weakest) return 'no_upgrade';

  if (
    inviteSize > 0 &&
    weakest.size > 0 &&
    !groupQuality.inviteHasMoreMembersThan(inviteInfo, weakest)
  ) {
    warningLog(
      `Convite ignorado — ${inviteSize} membros não supera o grupo atual (${weakest.size}): ${inviteInfo.subject || inviteInfo.id}`
    );
    return 'no_upgrade';
  }

  const weakestRecord = weakest._record || groupValidator.loadActiveGroups()[weakest.id] || weakest;
  if (!groupQuality.shouldVacateForInvite(weakestRecord, inviteInfo)) return 'no_upgrade';

  try {
    const churn = require('./groupChurnGuard');
    const vacateGate = churn.canVacateForUpgrade(weakest.id);
    if (!vacateGate.ok) {
      churn.logBlocked(
        `upgrade adiado (~${vacateGate.remainingMin} min)`,
        weakest.subject || weakest.id,
        `churn-upgrade-${weakest.id}`
      );
      return 'no_upgrade';
    }
  } catch {
    /* ignore */
  }

  successLog(
    `Upgrade: saindo de "${weakest.subject || weakest.id}" (${weakest.size} membros) → convite melhor (~${inviteSize})`
  );

  const out = await groupBanGuard.safeLeaveGroup(sock, weakest.id, 'substituído por grupo maior', {
    bypassBanGuard: true,
    policyCheck: async () => true,
  });

  if (!out.left) return 'uncertain';

  groupCache.invalidate();
  monitor.inc('groupUpgrades');
  return 'vacated';
};

/** Convite com tamanho ao vivo quando possível */
exports.resolveInviteInfo = async (sock, code, info) => {
  const inviteSizing = require('./inviteSizing');
  return inviteSizing.enrichInviteInfo(sock, code, info);
};

module.exports = exports;
