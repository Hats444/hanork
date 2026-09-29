'use strict';

/**
 * Remoção completa de um grupo do runtime (padrão: on-leave → tear-down).
 * Sai de gruposAtivos, cancela filas/schedulers e evita novas tentativas de post/join.
 */

const groupValidator = require('./groupValidator');
const groupCache = require('./groupCache');
const blacklist = require('./blacklist');
const { infoLog } = require('../utils/logger');

function cancelQueuesForGroup(jid) {
  let n = 0;
  try {
    n += require('./persistentQueue').cancelJobsForGroup(jid) || 0;
  } catch {
    /* ignore */
  }
  try {
    require('./groupReclassify').dropPending(jid);
  } catch {
    /* ignore */
  }
  return n;
}

function purgeMaps(jid) {
  try {
    require('./forbiddenCleanup').purgeStateMapsOnly(jid);
  } catch {
    /* ignore */
  }
}

/**
 * @param {string} jid
 * @param {string} reason
 * @param {{ blockList?: boolean, log?: boolean, subject?: string }} opts
 */
exports.dropGroup = (jid, reason = 'saiu', opts = {}) => {
  if (!jid || !jid.endsWith('@g.us')) return { ok: false };

  const blockList = opts.blockList === true;
  const log = opts.log !== false;
  const hadActive = Boolean(groupValidator.loadActiveGroups()[jid]);
  const subject =
    opts.subject || groupValidator.loadActiveGroups()[jid]?.subject || jid.split('@')[0];

  const jobs = cancelQueuesForGroup(jid);
  purgeMaps(jid);

  try {
    require('./groupEventScheduler').unschedule(jid);
  } catch {
    /* ignore */
  }
  try {
    const s = require('./groupScheduler').loadState();
    if (s?.groups?.[jid]) {
      delete s.groups[jid];
      require('../utils/debouncedStore').setCritical('schedulerState.json', s);
    }
  } catch {
    /* ignore */
  }
  try {
    require('./timerRegistry').cancel(`post:${jid}`);
  } catch {
    /* ignore */
  }

  if (blockList) blacklist.blockGroup(jid);
  else blacklist.unblockGroup(jid);

  groupValidator.markInvalid(jid, String(reason || 'saiu').slice(0, 120));
  groupCache.invalidate();

  if (log && hadActive) {
    infoLog(`Grupo removido do registro (${reason}): ${subject}${jobs ? ` · ${jobs} fila(s)` : ''}`);
  }

  return { ok: true, jobsCancelled: jobs, hadActive };
};

/** Bot saiu ou foi removido — sempre limpa runtime */
exports.onBotLeft = (jid, reason = 'bot saiu', opts = {}) => {
  try {
    const active = groupValidator.loadActiveGroups()[jid] || {};
    const invalid = groupValidator.loadInvalidGroups()[jid] || {};
    require('./groupChurnGuard').recordLeave(jid, {
      inviteCode: opts.inviteCode || active.inviteCode || invalid.inviteCode,
      reason,
    });
  } catch {
    /* ignore */
  }
  return exports.dropGroup(jid, reason, { blockList: opts.blockList ?? false, ...opts });
};

/** Confirmado que não está mais no WhatsApp (sync confiável + metadata) */
exports.onConfirmedAbsent = (jid, reason = 'ausente no WhatsApp') =>
  exports.dropGroup(jid, reason, { blockList: false });

module.exports = exports;
