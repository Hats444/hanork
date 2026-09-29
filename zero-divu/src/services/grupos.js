'use strict';

const blacklist = require('./blacklist');
const groupValidator = require('./groupValidator');
const groupCache = require('./groupCache');
const postGuard = require('./postGuard');
const groupReclassify = require('./groupReclassify');
const cfg = require('../config/divulgacao');
const groupOnboarding = require('./groupOnboarding');
const groupClassifier = require('./groupClassifier');
const safe = require('../utils/safe');
const { infoLog } = require('../utils/logger');

exports.fetchParticipatingGroups = async (sock, force = false) => {
  const raw = await groupCache.getParticipating(sock, force);
  return Object.values(raw || {});
};

exports.syncGroupsFromWhatsApp = async (sock, force = false) => {
  const groups = await exports.fetchParticipatingGroups(sock, force);
  const changedJids = [];
  const minMembers = cfg.MIN_MEMBERS_IN_GROUP ?? 0;

  for (const g of groups) {
    if (require('./forbiddenCleanup').isForbiddenRecord({ id: g.id, ...g })) {
      const healed = await require('./groupBanGuard').healIfPresentInWhatsApp(sock, g.id, {
        subject: g.subject,
        desc: g.desc ? String(g.desc).slice(0, 500) : undefined,
        announce: g.announce,
        size: g.participants?.length || g.size,
      });
      if (healed) {
        infoLog(`Grupo reativado após sync: ${g.subject || g.id.split('@')[0]}`);
      } else if (await groupCache.hasGroup(sock, g.id)) {
        blacklist.unblockGroup(g.id);
        groupValidator.clearInvalid(g.id);
        infoLog(`Grupo mantido (forbidden revertido): ${g.subject || g.id.split('@')[0]}`);
      }
      continue;
    }
    if (blacklist.isGroupBlocked(g.id)) {
      const groupBanGuard = require('./groupBanGuard');
      const healed = await groupBanGuard.healIfPresentInWhatsApp(sock, g.id, {
        subject: g.subject,
        desc: g.desc ? String(g.desc).slice(0, 500) : undefined,
        announce: g.announce,
        size: g.participants?.length || g.size,
      });
      if (healed) {
        infoLog(`Blacklist revertida (ainda no grupo): ${g.subject || g.id.split('@')[0]}`);
      } else if (await groupCache.hasGroup(sock, g.id)) {
        blacklist.unblockGroup(g.id);
        groupValidator.clearInvalid(g.id);
        infoLog(`Grupo mantido (sync): ${g.subject || g.id.split('@')[0]}`);
      } else {
        continue;
      }
    }
    const prev = groupValidator.loadActiveGroups()[g.id];
    const isNewGroup = !prev;
    if (groupReclassify.detectChangesFromSync(g, prev)) {
      changedJids.push(g.id);
    }
    const wasPending = prev?.pendingApproval;
    const size = g.participants?.length || g.size || 0;
    groupValidator.registerGroup(g.id, {
      subject: g.subject,
      desc: g.desc ? String(g.desc).slice(0, 500) : prev?.desc,
      announce: g.announce ?? prev?.announce,
      size,
      groupType: prev?.groupType,
      classifyFingerprint: prev?.classifyFingerprint,
      classifiedAt: prev?.classifiedAt,
      pendingApproval: false,
      ...(isNewGroup ? { manualJoin: true, joinedAt: new Date().toISOString() } : {}),
    });
    if (g.desc || g.subject) {
      try {
        require('./groupMetadataCache').set(g.id, {
          subject: g.subject,
          desc: g.desc,
          announce: g.announce,
          size: g.participants?.length || g.size,
        });
      } catch {
        /* ignore */
      }
    }
    if (wasPending) {
      safe.runSilent('Aprovação (sync grupo)', () => groupOnboarding.handleApproved(sock, g.id));
    } else if (isNewGroup && size >= (minMembers || 1)) {
      safe.runSilent('Entrada manual (sync)', () =>
        require('./manualJoinRealtime').handleManualJoin(sock, g.id, {
          source: 'sync',
          subject: g.subject,
          size,
          announce: g.announce,
        })
      );
    }

    // Regra de qualidade: sair de grupos abaixo do mínimo de membros (confirmado ao vivo).
    const { isProtectedGroup } = require('../utils/manualJoinPolicy');
    const activeNow = groupValidator.loadActiveGroups()[g.id] || {};
    if (
      minMembers > 0 &&
      prev?.groupType !== 'chat' &&
      !prev?.visitOnly &&
      !isProtectedGroup(activeNow)
    ) {
      const groupBanGuard = require('./groupBanGuard');
      const tooSmall = await groupBanGuard.confirmMemberCountBelow(sock, g.id, minMembers, size);
      if (tooSmall) {
        const out = await groupBanGuard.safeLeaveGroup(sock, g.id, `poucos membros (${size})`, {
          bypassBanGuard: true,
          policyCheck: async () => true,
        });
        if (out.left) {
          require('../utils/logger').warningLog(
            `Saiu de grupo pequeno (confirmado < ${minMembers}): ${g.subject || g.id.split('@')[0]}`
          );
          continue;
        }
      }
    }
  }

  if (changedJids.length && cfg.ENABLE_AUTO_RECLASSIFY) {
    for (const jid of changedJids) groupReclassify.enqueue(jid);
  }

  await exports.reconcileGhostRegistry(sock);

  try {
    await require('./dualOverlapMonitor').runOverlapPass(sock);
  } catch {
    /* ignore */
  }

  if (cfg.MEMBER_AUDIT_ON_SYNC !== false && groupCache.isSyncTrustworthy()) {
    try {
      await require('./groupMemberPolicy').auditNextBatch(sock);
    } catch {
      /* ignore */
    }
  }

  return groups;
};

/**
 * Remove do JSON grupos que o bot já saiu (fantasmas).
 * Roda mesmo com sync parcial — confirma com groupMetadata antes de apagar.
 */
exports.reconcileGhostRegistry = async (sock, opts = {}) => {
  if (!sock) return { dropped: 0, uncertain: 0 };

  const participating = await groupCache.getParticipating(sock, false);
  const waIds = new Set(
    Object.keys(participating || {}).filter((k) => k.endsWith('@g.us'))
  );
  const active = groupValidator.loadActiveGroups();
  const drop = require('./groupRegistryCleanup');
  const minMembers = cfg.MIN_MEMBERS_IN_GROUP ?? 0;
  const maxChecks = opts.maxChecks ?? cfg.GHOST_RECONCILE_MAX_CHECKS ?? 12;
  const { sleep } = require('../utils/sleep');
  const gapMs = cfg.GHOST_RECONCILE_CHECK_GAP_MS ?? 800;

  let dropped = 0;
  let uncertain = 0;
  let checks = 0;

  const orphans = Object.keys(active).filter((jid) => !waIds.has(jid));
  orphans.sort((a, b) => {
    const ga = active[a];
    const gb = active[b];
    const sa = ga?.size || 0;
    const sb = gb?.size || 0;
    if (minMembers > 0) {
      const aSmall = sa > 0 && sa < minMembers ? 0 : 1;
      const bSmall = sb > 0 && sb < minMembers ? 0 : 1;
      if (aSmall !== bSmall) return aSmall - bSmall;
    }
    return (ga?.lastPostAt || '').localeCompare(gb?.lastPostAt || '');
  });

  for (const jid of orphans) {
    if (checks >= maxChecks) break;
    const g = active[jid];
    if (!g) continue;

    checks++;
    if (gapMs > 0 && checks > 1) await sleep(gapMs);

    const live = await groupCache.confirmMembershipLive(sock, jid);
    if (live === true) continue;
    if (live === null) {
      uncertain++;
      continue;
    }

    drop.onConfirmedAbsent(jid, 'não está no WhatsApp (fantasma removido)');
    dropped++;
  }

  if (dropped > 0) {
    infoLog(
      `Registro limpo: ${dropped} grupo(s) fantasma(s) removido(s)${uncertain ? ` · ${uncertain} incerto(s)` : ''}`
    );
  }

  return { dropped, uncertain };
};

/** @deprecated use reconcileGhostRegistry */
exports.dropAbsentFromRegistry = async (sock) => {
  const out = await exports.reconcileGhostRegistry(sock);
  return out.dropped || 0;
};

function divulgacaoOnly(list) {
  if (!cfg.ENABLE_GROUP_CLASSIFIER) return list;
  return list.filter((g) => groupClassifier.isEligibleForCycle(g));
}

exports.getActiveGroupIds = () => {
  const list = divulgacaoOnly(groupValidator.listSortedByScore());
  return require('./groupMembership').filterInWhatsApp(list).map((g) => g.id);
};

exports.getEligibleGroupIds = (opts = {}) => {
  const candidates = divulgacaoOnly(groupValidator.listSortedByScore());
  const groupHealth = require('./groupHealth');
  const { ok } = groupHealth.filterHealthy(candidates);

  if (cfg.DISTRIBUTED_SCHEDULER_ENABLED !== false) {
    const groupScheduler = require('./groupScheduler');
    const operationalLimits = require('./operationalLimits');
    const distributedScheduler = require('./distributedScheduler');
    const patternGuard = require('./patternGuard');
    for (const g of ok) groupScheduler.syncFromGroup(g.id, g);
    const cap =
      opts.maxPerWake ??
      (distributedScheduler.isEnabled()
        ? distributedScheduler.maxGroupsPerWake()
        : operationalLimits.getMaxGroupsPerCycle());
    const ids = groupScheduler.pickForCycle(ok, cap || ok.length);
    const filtered = postGuard.filterEligibleIds(ids);
    return patternGuard.shouldShuffleOrder(filtered);
  }

  return postGuard.filterEligibleGroups(ok);
};

exports.classifyExistingGroups = async (sock) => {
  groupReclassify.scheduleWhenStable(sock);
};

exports.runReclassificationCycle = async (sock) => {
  await groupReclassify.runCycle(sock, { onlyUnclassified: false });
};

exports.getLeastActiveGroup = () => {
  try {
    const pick = require('./groupVacancy').pickGroupToVacate();
    if (pick) return pick;
  } catch {
    /* ignore */
  }
  const list = groupValidator.listSortedByScore();
  const chats = list.filter((g) => g.groupType === 'chat');
  if (chats.length) return chats[chats.length - 1];
  return list.length ? list[list.length - 1] : null;
};
