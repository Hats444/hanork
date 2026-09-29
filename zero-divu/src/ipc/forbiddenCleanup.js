'use strict';

const cfg = require('../config/divulgacao');
const blacklist = require('./blacklist');
const groupValidator = require('./groupValidator');
const groupCache = require('./groupCache');
const groupProfile = require('./groupProfile');
const pendingInvites = require('./pendingInvites');
const groupBanGuard = require('./groupBanGuard');
const { warningLog, infoLog, successLog } = require('../utils/logger');

function isForbiddenText(text) {
  if (groupBanGuard.isRateOrTransient(text)) return false;
  return /forbidden|not-authorized|not authorized|403/i.test(String(text || ''));
}

/** Grupo banido / removido — não deve ficar em gruposAtivos nem na fila de reclassificação */
exports.isForbiddenRecord = (group) => {
  if (!group?.id) return false;
  if (isForbiddenText(group.classifyPendingReason)) return true;
  if (isForbiddenText(group.metadataError)) return true;
  if (group.classifyPendingVerify && isForbiddenText(group.classifyPendingReason)) return true;
  return false;
};

exports.purgeStateMapsOnly = purgeStateMaps;

function purgeStateMaps(jid) {
  try {
    require('./groupMetadataCache').remove(jid);
  } catch {
    /* ignore */
  }
  try {
    const store = require('../utils/debouncedStore');
    store.updateCritical('schedulerState.json', (s) => {
      if (s.groups?.[jid]) delete s.groups[jid];
      return s;
    }, {});
    store.updateCritical('groupReputation.json', (s) => {
      if (s.groups?.[jid]) delete s.groups[jid];
      return s;
    }, {});
  } catch {
    /* ignore */
  }
  try {
    require('./groupEventScheduler').unschedule(jid);
  } catch {
    /* ignore */
  }
  try {
    require('./timerRegistry').cancel(`post:${jid}`);
    require('./timerRegistry').cancel(`event:${jid}`);
  } catch {
    /* ignore */
  }
  try {
    require('./groupReclassify').dropPending(jid);
  } catch {
    /* ignore */
  }
}

/** Só disco — sem sair do WhatsApp (boot síncrono) */
exports.purgeRegistryOnly = (jid, reason = 'forbidden', opts = {}) => {
  if (!jid) return false;
  const blockList = opts.blockList !== false;
  require('./groupRegistryCleanup').dropGroup(jid, reason, { blockList, log: opts.log !== false });
  return true;
};

/** Remove um grupo banido dos arquivos e do WhatsApp (se ainda estiver listado) */
exports.removeGroup = async (sock, jid, reason = 'forbidden', opts = {}) => {
  if (!jid) return false;

  const active = groupValidator.loadActiveGroups()[jid] || {};
  const subject = active.subject || jid.split('@')[0];

  if (sock?.groupLeave && !opts.skipLeave) {
    let inWa = await groupCache.hasGroup(sock, jid);
    if (!inWa) {
      const live = await groupCache.confirmMembershipLive(sock, jid);
      if (live === true) inWa = true;
      else if (live === null) {
        infoLog(`Grupo mantido (sync incerto): ${subject}`);
        return false;
      }
    }
    if (inWa) {
      const out = await groupBanGuard.safeLeaveGroup(sock, jid, reason, opts);
      if (!out.left) {
        await groupBanGuard.healIfPresentInWhatsApp(sock, jid, active);
        infoLog(`Grupo mantido (sem confirmação de ban): ${subject}`);
        return false;
      }
      warningLog(`Confirmado ban/remoção — saiu do grupo: ${subject}`);
    }
  }

  require('./groupRegistryCleanup').dropGroup(jid, reason, {
    blockList: true,
    log: false,
    subject,
  });
  return true;
};

/** Varre gruposAtivos e remove todos com forbidden / ban */
exports.purgeForbiddenFromFiles = async (sock, opts = {}) => {
  const active = groupValidator.loadActiveGroups();
  const toRemove = [];

  for (const [jid, g] of Object.entries(active)) {
    if (exports.isForbiddenRecord(g)) {
      toRemove.push(jid);
      continue;
    }
    if (g.classifyPendingVerify && !groupProfile.hasUsableDescription({}, g)) {
      if (isForbiddenText(g.classifyPendingReason)) toRemove.push(jid);
    }
  }

  let removed = 0;
  for (const jid of toRemove) {
    const g = active[jid];
    const reason = g?.classifyPendingReason || 'forbidden';
    let inWa = false;
    if (sock) {
      inWa = await groupCache.hasGroup(sock, jid);
      if (!inWa) {
        const live = await groupCache.confirmMembershipLive(sock, jid);
        if (live === true) inWa = true;
        else if (live === null) continue;
      }
    }
    if (inWa && !opts.forceLeave) {
      const healed = await groupBanGuard.healIfPresentInWhatsApp(sock, jid, g);
      if (healed) {
        infoLog(`Forbidden revertido (grupo ainda ativo): ${g.subject || jid.split('@')[0]}`);
        continue;
      }
    }
    await exports.removeGroup(sock, jid, reason, { skipLeave: opts.skipLeave, ...opts });
    removed++;
  }

  if (removed > 0) {
    infoLog(`${removed} grupo(s) forbidden removido(s) dos arquivos`);
  }

  return removed;
};

/** Após liberar vaga, tenta convites guardados (mesmo em horário quieto, se configurado) */
exports.nudgeSavedInvites = (sock) => {
  if (!sock || cfg.AUTO_JOIN_GROUPS === false) return 0;

  const bypassQuiet = cfg.FORBIDDEN_CLEANUP_NUDGE_JOINS !== false;
  const activeHours = require('../utils/activeHours');
  if (!bypassQuiet && !activeHours.isActiveNow()) return 0;

  const queue = pendingInvites.listForProcessing();
  if (!queue.length) return 0;

  const joinManager = require('./joinManager');
  let n = 0;
  const max = cfg.FORBIDDEN_CLEANUP_MAX_JOIN_NUDGE ?? 6;

  for (const item of queue.slice(0, max)) {
    if (blacklist.isInviteBlocked(item.code)) {
      pendingInvites.remove(item.code);
      continue;
    }
    joinManager.enqueueInvite(sock, item.code, { ...item.meta, afterForbidden: true });
    n++;
  }

  if (n > 0) {
    successLog(`${n} convite(s) na fila — preenchendo vaga após grupo banido`);
  }
  return n;
};

/** Detectado ao buscar metadados — limpa e abre fila de entrada */
exports.onForbiddenDetected = async (sock, jid, errMsg = 'forbidden') => {
  if (!jid) return false;
  if (groupBanGuard.isRateOrTransient(errMsg)) return false;

  const active = groupValidator.loadActiveGroups()[jid];
  if (!active && !blacklist.isGroupBlocked(jid)) return false;

  if (sock) {
    const inWa = await groupCache.hasGroup(sock, jid);
    if (inWa) {
      const confirmed = await groupBanGuard.confirmForbiddenAccess(sock, jid);
      if (!confirmed) {
        await groupBanGuard.healIfPresentInWhatsApp(sock, jid, active || {});
        return false;
      }
    } else {
      require('./groupRegistryCleanup').dropGroup(jid, String(errMsg).slice(0, 80), { blockList: true });
      return true;
    }
  }

  await exports.removeGroup(sock, jid, String(errMsg).slice(0, 80), { forceLeave: true });
  exports.nudgeSavedInvites(sock);
  return true;
};

module.exports = exports;
