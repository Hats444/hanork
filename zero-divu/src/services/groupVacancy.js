'use strict';

const blacklist = require('./blacklist');
const groupValidator = require('./groupValidator');
const groupCache = require('./groupCache');
const groupBanGuard = require('./groupBanGuard');
const monitor = require('./monitor');
const { warningLog, infoLog, successLog } = require('../utils/logger');

const forbiddenCleanup = () => require('./forbiddenCleanup');

const VACATE_CHECKS = [
  { label: 'banido', test: (g) => blacklist.isGroupBlocked(g.id) },
  { label: 'forbidden', test: (g) => forbiddenCleanup().isForbiddenRecord(g) },
  { label: 'morto', test: (g) => g.healthPaused && g.healthStatus === 'dead' },
  { label: 'proibido', test: (g) => g.postPermission === 'denied' || g.classifyAction === 'visit_once' },
  {
    label: 'sem ciclo',
    test: (g) => g.classifyAction === 'stay_cautious' && g.postPermission !== 'allowed',
  },
  { label: 'chat', test: (g) => g.groupType === 'chat' },
];

/** Escolhe qual grupo sair para abrir vaga (prioriza banidos, mortos, não-divulgação). */
exports.pickGroupToVacate = () => {
  const sorted = groupValidator.listSortedByScore();
  for (const { test } of VACATE_CHECKS) {
    const hit = sorted.find((g) => g?.id && test(g));
    if (hit) return hit;
  }
  return sorted.length ? sorted[sorted.length - 1] : null;
};

/**
 * Reconcilia membership após boot — NÃO sai de grupos só por registro em disco.
 * Restaura falsos banidos; só limpa disco quando o grupo já não está no WhatsApp.
 */
exports.reconcileMembership = async (sock) => {
  if (!sock) return { healed: 0, purged: 0, left: 0 };

  let participating = {};
  try {
    participating = (await groupCache.getParticipating(sock, false)) || {};
  } catch {
    infoLog('Reconciliação de grupos adiada — sync indisponível');
    return { healed: 0, purged: 0, left: 0, skipped: true };
  }

  const syncTrustworthy = groupCache.isSyncTrustworthy();
  const waIds = new Set(Object.keys(participating));
  let healed = 0;
  let purged = 0;

  for (const jid of waIds) {
    const blocked = blacklist.isGroupBlocked(jid);
    const invalid = groupValidator.loadInvalidGroups()[jid];
    if (!blocked && !invalid) continue;

    const g = participating[jid] || {};
    const active = groupValidator.loadActiveGroups()[jid] || {};
    const ok = await groupBanGuard.healIfPresentInWhatsApp(sock, jid, {
      subject: g.subject || active.subject,
      desc: String(g.desc || active.desc || '').slice(0, 500) || undefined,
      announce: g.announce ?? active.announce,
      size: g.participants?.length || g.size || active.size,
    });
    if (ok) {
      healed++;
      successLog(`Grupo restaurado: ${g.subject || active.subject || jid.split('@')[0]}`);
    }
  }

  for (const jid of blacklist.listBlockedGroups()) {
    if (waIds.has(jid)) continue;
    if (!syncTrustworthy) continue;
    const live = await groupCache.confirmMembershipLive(sock, jid);
    if (live === true) {
      await groupBanGuard.healIfPresentInWhatsApp(sock, jid, groupValidator.loadActiveGroups()[jid] || {});
      healed++;
      continue;
    }
    if (live === null) continue;
    require('./groupRegistryCleanup').onConfirmedAbsent(jid);
    purged++;
  }

  const invalid = groupValidator.loadInvalidGroups();
  for (const [jid, meta] of Object.entries(invalid)) {
    if (waIds.has(jid)) continue;
    if (!syncTrustworthy) continue;
    const reason = String(meta?.reason || '');
    if (!/banido|removido|blacklist|forbidden|bot removido/i.test(reason)) continue;
    const live = await groupCache.confirmMembershipLive(sock, jid);
    if (live === true) {
      await groupBanGuard.healIfPresentInWhatsApp(sock, jid, { subject: meta?.subject });
      healed++;
      continue;
    }
    if (live === null) continue;
    const blockList = /bot removido/i.test(reason);
    require('./groupRegistryCleanup').dropGroup(jid, reason.slice(0, 80), { blockList });
    purged++;
  }

  const forbiddenRemoved = await forbiddenCleanup().purgeForbiddenFromFiles(sock, {
    skipLeave: true,
  });
  if (forbiddenRemoved > 0) purged += forbiddenRemoved;

  if (healed > 0 || purged > 0) {
    infoLog(`Membership: ${healed} restaurado(s) · ${purged} registro(s) limpo(s)`);
  } else if (!syncTrustworthy) {
    const waN = groupCache.countParticipatingGroups?.() ?? waIds.size;
    const diskN = Object.keys(groupValidator.loadActiveGroups()).length;
    infoLog(
      `Reconciliação parcial — sync incompleto (WA ${waN} · registro ${diskN}) — sem limpar ausentes nem sair`
    );
  }

  return { healed, purged, left: 0, forbiddenRemoved };
};

/** @deprecated Use reconcileMembership — mantido por compatibilidade */
exports.leaveBannedAndStale = async (sock) => {
  const out = await exports.reconcileMembership(sock);
  if (out.healed > 0 || out.purged > 0) {
    infoLog(`Vagas liberadas: ${out.left || 0} saída(s) · ${out.purged} registro(s) limpo(s)`);
  }
  forbiddenCleanup().nudgeSavedInvites(sock);
  return { left: out.left || 0, cleaned: out.purged, forbiddenRemoved: out.forbiddenRemoved || 0 };
};

module.exports = exports;
