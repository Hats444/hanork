'use strict';

const cfg = require('../config/divulgacao');
const groupValidator = require('./groupValidator');
const groupBanGuard = require('./groupBanGuard');
const { sleep } = require('../utils/sleep');
const { warningLog } = require('../utils/logger');
const { appendWaOpsEvent } = require('../utils/opsMetrics');

function leaveThreshold() {
  return Math.max(1, Number(cfg.STATUS_LEAVE_AFTER_FAILS) || 4);
}

function autoLeaveEnabled(group) {
  return (
    cfg.STATUS_AUTO_LEAVE_ON_ANNOUNCE_ONLY !== false &&
    cfg.ENABLE_AUTO_EXIT !== false &&
    !group?.manualJoin
  );
}

exports.isAnnounceOnlyReason = (reason) =>
  /só-admins|status bloqueado — grupo só-admins/i.test(String(reason || ''));

exports.leaveThreshold = leaveThreshold;

exports.resetStreak = (groupId) => {
  if (!groupId) return;
  const active = groupValidator.loadActiveGroups()[groupId];
  if (!active?.statusFailCount) return;
  try {
    groupValidator.registerGroup(groupId, { statusFailCount: 0 });
  } catch {
    /* ignore */
  }
};

exports.handleFailure = async (sock, groupId, opts = {}) => {
  const active = groupValidator.loadActiveGroups()[groupId] || {};
  const name =
    opts.name ||
    active.subject ||
    String(groupId || '').split('@')[0] ||
    groupId;
  const failCount = (active.statusFailCount || 0) + 1;
  const threshold = leaveThreshold();

  try {
    groupValidator.registerGroup(groupId, {
      postPermission: 'denied',
      statusBlockedReason: 'só-admins (membro)',
      statusFailCount: failCount,
      lastStatusFailAt: new Date().toISOString(),
      announceOnlySince: active.announceOnlySince || new Date().toISOString(),
    });
  } catch {
    /* ignore */
  }

  if (!autoLeaveEnabled(active)) {
    if (failCount === 1) {
      warningLog(`${name}: só-admins — bot membro (entrada manual — não sai automaticamente)`);
    }
    return { failCount, left: false, threshold };
  }

  if (failCount >= threshold) {
    try {
      await sleep(1500);
      const out = await groupBanGuard.safeLeaveGroup(
        sock,
        groupId,
        `só-admins — ${failCount} falha(s) seguida(s) na divulgação`,
        { bypassBanGuard: true, policyCheck: async () => true }
      );
      if (out.left) {
        warningLog(
          `${name}: saiu do grupo após ${failCount} falha(s) seguida(s) em só-admins (bot não é admin)`
        );
        try {
          require('../ipc/eventBus').emitLeave({
            group: name,
            reason: `só-admins — ${failCount} falhas seguidas (auto-saída)`,
          });
        } catch {
          /* IPC opcional */
        }
        try {
          appendWaOpsEvent({
            kind: 'countermeasure',
            target: name,
            detail: 'só-admins — auto-saída após falhas consecutivas',
            countermeasure: 'leave group',
          });
        } catch {
          /* ignore */
        }
        return { failCount, left: true, threshold };
      }
    } catch {
      /* ignore */
    }
  }

  const left = threshold - failCount;
  warningLog(
    `${name}: só-admins — falha ${failCount}/${threshold} (${left} restante(s) antes de sair)`
  );

  if (failCount === 1) {
    try {
      require('../ipc/eventBus').emitStatusBlocked({
        group: name,
        reason: 'só-admins — promova o bot a admin ou sairá após falhas consecutivas',
        manualJoin: Boolean(active.manualJoin),
        size: active.size || null,
      });
    } catch {
      /* IPC opcional */
    }
  }

  return { failCount, left: false, threshold };
};

module.exports = exports;
