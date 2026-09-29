'use strict';

const cfg = require('../config/divulgacao');
const groupValidator = require('./groupValidator');
const blacklist = require('./blacklist');
const groupBanGuard = require('./groupBanGuard');
const { warningLog } = require('../utils/logger');

exports.run = async (sock) => {
  if (!cfg.ENABLE_AUTO_CLEANUP) return;

  try {
    await require('./databaseMaintenance').run(sock);
  } catch {
    /* ignore */
  }

  const active = groupValidator.loadActiveGroups();
  const now = Date.now();
  const inactiveMs = cfg.GROUP_INACTIVITY_MS || 7 * 24 * 60 * 60 * 1000;
  const minErrorsBeforeLeave = cfg.CLEANUP_LEAVE_MIN_ERRORS ?? 8;

  for (const [jid, g] of Object.entries(active)) {
    if (g.groupType === 'chat' || g.visitOnly) continue;

    if (blacklist.isGroupBlocked(jid)) {
      const healed = await groupBanGuard.healIfPresentInWhatsApp(sock, jid, g);
      if (healed) continue;
      const shouldLeave = await groupBanGuard.shouldLeaveGroup(sock, jid, 'blacklist');
      if (!shouldLeave) continue;
      const out = await groupBanGuard.safeLeaveGroup(sock, jid, 'blacklist', {
        bypassBanGuard: true,
        policyCheck: async () => shouldLeave,
      });
      if (out.left) {
        warningLog(`Saiu de grupo banido (confirmado): ${g.subject || jid.split('@')[0]}`);
      }
      continue;
    }

    const last = g.lastPostAt ? new Date(g.lastPostAt).getTime() : new Date(g.joinedAt || 0).getTime();
    const inactive = now - last > inactiveMs;
    const failHeavy = (g.postsFail || 0) > (g.postsOk || 0) + 2;

    if (inactive && failHeavy && (g.errors || 0) >= 3) {
      const out = await groupBanGuard.safeLeaveGroup(sock, jid, 'inativo', {
        bypassBanGuard: true,
        policyCheck: async () => inactive && failHeavy,
      });
      if (out.left) {
        warningLog(`Saiu de grupo inativo: ${g.subject || jid.split('@')[0]}`);
      }
      continue;
    }

    if ((g.errors || 0) >= minErrorsBeforeLeave) {
      const out = await groupBanGuard.safeLeaveGroup(sock, jid, 'muitos erros', {
        bypassBanGuard: true,
        policyCheck: async () => (g.errors || 0) >= minErrorsBeforeLeave,
      });
      if (out.left) {
        /* drop feito em safeLeaveGroup */
      }
    }
  }
};
