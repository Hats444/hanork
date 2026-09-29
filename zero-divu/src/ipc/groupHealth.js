'use strict';

const cfg = require('../config/divulgacao');
const groupValidator = require('./groupValidator');
const groupReputation = require('./groupReputation');
const groupBanGuard = require('./groupBanGuard');
const groupCache = require('./groupCache');
const { warningLog, infoLog } = require('../utils/logger');

const MIN_MEMBERS_DEAD = 3;
const INACTIVE_DAYS = 14;

function daysSince(iso) {
  if (!iso) return Infinity;
  return (Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000);
}

exports.analyze = (group) => {
  if (!group?.id) return { health: 'unknown', score: 50, reasons: [] };

  const reasons = [];
  let score = 70;

  const size = group.size || 0;
  if (size > 0 && size <= MIN_MEMBERS_DEAD) {
    score -= 25;
    reasons.push('poucos membros');
  }

  if (group.pendingApproval) {
    score -= 30;
    reasons.push('aprovação pendente');
  }

  if (group.announce === true && size > 0 && size <= 5) {
    score -= 20;
    reasons.push('grupo só-admins com poucos membros');
  }

  if (group.announce === true && !group.lastPostAt && daysSince(group.joinedAt || group.classifiedAt) > 7) {
    score -= 15;
    reasons.push('grupo anúncio sem atividade desde entrada');
  }

  const daysIdle = daysSince(group.lastPostAt || group.joinedAt);
  if (daysIdle > INACTIVE_DAYS * 2) {
    score -= 20;
    reasons.push('grupo congelado (inativo prolongado)');
  }

  if ((group.errors || 0) >= (cfg.GROUP_ERROR_PAUSE_THRESHOLD ?? 3)) {
    score -= 20;
    reasons.push('muitas falhas recentes');
  }

  if (daysSince(group.lastPostAt) > INACTIVE_DAYS && group.lastPostAt) {
    score -= 15;
    reasons.push('sem post há muito tempo');
  }

  if (groupReputation.shouldDeprioritize(group.id)) {
    score -= 15;
    reasons.push('reputação baixa');
  }

  let health = 'healthy';
  if (score < 35) health = 'dead';
  else if (score < 55) health = 'weak';
  else if (score < 70) health = 'fair';

  return { health, score, reasons };
};

exports.filterHealthy = (groups) => {
  const ok = [];
  const paused = [];

  for (const g of groups) {
    if (g.healthPaused) {
      paused.push({ id: g.id, health: g.healthStatus || 'paused', reasons: ['pausado por saúde'] });
      continue;
    }
    const { health, reasons } = exports.analyze(g);
    if (health === 'dead' && cfg.GROUP_HEALTH_PAUSE_DEAD !== false) {
      paused.push({ id: g.id, health, reasons });
      continue;
    }
    ok.push(g);
  }

  return { ok, paused };
};

exports.markDeadGroups = () => {
  const active = groupValidator.loadActiveGroups();
  let marked = 0;
  const now = new Date().toISOString();
  for (const [jid, g] of Object.entries(active)) {
    const { health } = exports.analyze(g);
    if (health === 'dead' && !g.healthPaused) {
      groupValidator.registerGroup(jid, {
        healthPaused: true,
        healthStatus: 'dead',
        healthPausedAt: g.healthPausedAt || now,
      });
      marked++;
    }
  }
  return marked;
};

exports.runMaintenance = async (sock) => {
  if (sock && cfg.GHOST_RECONCILE_ON_MAINTENANCE !== false) {
    try {
      await require('./grupos').reconcileGhostRegistry(sock, {
        maxChecks: cfg.GHOST_RECONCILE_MAX_CHECKS ?? 8,
      });
    } catch {
      /* ignore */
    }
  }

  const marked = exports.markDeadGroups();
  if (marked > 0) infoLog(`Saúde: ${marked} grupo(s) marcado(s) como mortos`);

  if (cfg.GROUP_HEALTH_AUTO_LEAVE === false || !cfg.ENABLE_AUTO_EXIT) return 0;

  const minDaysPaused = cfg.HEALTH_AUTO_LEAVE_MIN_DAYS_PAUSED ?? 7;
  const active = groupValidator.loadActiveGroups();
  let left = 0;

  for (const [jid, g] of Object.entries(active)) {
    if (!g.healthPaused || g.healthStatus !== 'dead') continue;
    if (g.groupType === 'chat' || g.visitOnly) continue;

    const pausedDays = daysSince(g.healthPausedAt || g.classifiedAt || g.joinedAt);
    if (pausedDays < minDaysPaused) continue;

    const minMembers = cfg.MIN_MEMBERS_IN_GROUP ?? 0;
    if (minMembers > 0) {
      const tooSmall = await groupBanGuard.confirmMemberCountBelow(sock, jid, minMembers, g.size || 0);
      if (!tooSmall && (g.size || 0) > 0) continue;
    }

    const out = await groupBanGuard.safeLeaveGroup(sock, jid, 'grupo morto (saúde)', {
      bypassBanGuard: true,
      policyCheck: async () =>
        pausedDays >= minDaysPaused &&
        groupCache.isSyncTrustworthy() &&
        (await groupCache.confirmMembershipLive(sock, jid)) === true,
    });
    if (out.left) {
      left++;
      warningLog(`Saiu de grupo morto (${Math.round(pausedDays)}d pausado): ${g.subject || jid.split('@')[0]}`);
    }
  }

  return left;
};

module.exports = exports;
