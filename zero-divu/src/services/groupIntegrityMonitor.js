'use strict';

const cfg = require('../config/divulgacao');
const groupValidator = require('./groupValidator');
const groupRole = require('../utils/groupRole');
const groupBanGuard = require('./groupBanGuard');
const groupCache = require('./groupCache');
const { infoLog, warningLog } = require('../utils/logger');

function announceLeaveMs() {
  return Math.max(
    60 * 60 * 1000,
    Number(cfg.ANNOUNCE_ONLY_LEAVE_AFTER_MS) || 24 * 60 * 60 * 1000
  );
}

function msSince(iso) {
  if (!iso) return 0;
  return Date.now() - new Date(iso).getTime();
}

async function refreshLiveMeta(sock, jid, group) {
  if (!sock || !jid) return group;
  try {
    const live = await groupCache.confirmMembershipLive(sock, jid);
    if (live === false) {
      groupValidator.markInvalid(jid, 'não está no WhatsApp (saída/fantasma)');
      return null;
    }
    if (live === null) return group;

    const role = await groupRole.getBotRole(sock, jid);
    const announceOnly = groupRole.isAnnounceOnlyMember(role);
    const patch = {
      botIsAdmin: role?.admin === true,
      announce: role?.announce ?? group.announce,
      membershipVerifiedAt: new Date().toISOString(),
    };

    if (announceOnly) {
      patch.postPermission = group.postPermission === 'allowed' ? group.postPermission : 'denied';
      patch.statusBlockedReason = 'só-admins (membro)';
      if (!group.announceOnlySince) {
        patch.announceOnlySince = new Date().toISOString();
      }
    } else {
      patch.announceOnlySince = null;
      patch.statusFailCount = 0;
    }

    return groupValidator.registerGroup(jid, patch);
  } catch {
    return group;
  }
}

async function leaveIfAnnounceOnlyTooLong(sock, jid, group) {
  if (!group?.announceOnlySince) return false;
  if (group.manualJoin && cfg.ANNOUNCE_ONLY_RESPECT_MANUAL !== false) return false;
  if (msSince(group.announceOnlySince) < announceLeaveMs()) return false;

  const out = await groupBanGuard.safeLeaveGroup(sock, jid, 'só-admins >24h — liberando slot', {
    bypassBanGuard: true,
    policyCheck: async () => true,
  });

  if (out.left) {
    warningLog(
      `Integridade: saiu de ${group.subject || jid} (só-admins há >${Math.round(announceLeaveMs() / 3600000)}h)`
    );
    try {
      require('../ipc/eventBus').emitLeave({
        group: group.subject || jid,
        reason: 'só-admins prolongado — slot liberado',
      });
    } catch {
      /* ignore */
    }
    return true;
  }
  return false;
}

exports.runIntegrityPass = async (sock, opts = {}) => {
  if (!sock) return { checked: 0, ghosts: 0, announceLeft: 0 };

  const maxChecks = Math.max(1, Number(opts.maxChecks) || cfg.GROUP_INTEGRITY_MAX_CHECKS || 20);
  const active = groupValidator.loadActiveGroups();
  const ids = Object.keys(active);
  let checked = 0;
  let announceLeft = 0;
  let ghosts = 0;

  const ghostOut = await require('./grupos').reconcileGhostRegistry(sock, {
    maxChecks: Math.min(maxChecks, cfg.GHOST_RECONCILE_MAX_CHECKS ?? 12),
  });
  ghosts = ghostOut.dropped || 0;

  for (const jid of ids) {
    if (checked >= maxChecks) break;
    let group = groupValidator.loadActiveGroups()[jid];
    if (!group) continue;
    checked++;

    group = await refreshLiveMeta(sock, jid, group);
    if (!group) continue;

    if (await leaveIfAnnounceOnlyTooLong(sock, jid, group)) {
      announceLeft++;
    }
  }

  if (announceLeft > 0 || ghosts > 0) {
    infoLog(
      `Integridade grupos: ${checked} verificados · ${ghosts} fantasma(s) · ${announceLeft} saída(s) só-admins`
    );
  }

  return { checked, ghosts, announceLeft };
};

module.exports = exports;
