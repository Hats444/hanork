'use strict';

const cfg = require('../config/divulgacao');
const groupCache = require('./groupCache');
const groupValidator = require('./groupValidator');
const pendingInvites = require('./pendingInvites');
const limits = require('./operationalLimits');
const groupQuality = require('./groupQuality');
const { infoLog } = require('../utils/logger');

let lastRunAt = 0;

/**
 * Com fila de convites e limite cheio, tenta processar o melhor convite elegível.
 */
exports.tick = async (sock) => {
  if (!sock || cfg.AUTO_JOIN_GROUPS === false) return { skipped: true };
  if (!groupCache.isSyncTrustworthy()) return { skipped: true };

  const gap = cfg.GROUP_OPTIMIZER_INTERVAL_MS ?? 20 * 60 * 1000;
  if (Date.now() - lastRunAt < gap) return { skipped: true };
  lastRunAt = Date.now();

  const maxGroups = limits.getMaxGroups();
  const activeN = groupValidator.countActive();
  if (activeN < maxGroups) return { skipped: true, reason: 'below_cap' };

  const queue = pendingInvites.listForProcessing();
  if (!queue.length) return { skipped: true, reason: 'empty_queue' };

  const joinManager = require('./joinManager');
  for (const item of queue) {
    const invite = {
      id: item.meta?.id,
      subject: item.meta?.subject,
      size: item.inviteSize || item.meta?.size,
      announce: item.meta?.announce,
      groupType: item.meta?.groupType,
    };
    if (!groupQuality.inviteLikelyAllowsDivulgacao(invite)) continue;
    joinManager.enqueueInvite(sock, item.code, item.meta || {});
    infoLog(`Otimizador: convite priorizado (${invite.subject || item.code})`);
    return { enqueued: true };
  }
  return { skipped: true };
};

module.exports = exports;
