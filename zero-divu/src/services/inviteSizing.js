'use strict';

const pendingInvites = require('./pendingInvites');
const { debugLog } = require('../utils/logger');

/** Atualiza tamanho do convite na fila e no retorno de getInviteInfo */
exports.enrichInviteInfo = async (sock, code, info) => {
  if (!info) return info;
  let size = Number(info.size || 0);
  if (size <= 0 && sock?.groupGetInviteInfo && code) {
    try {
      const fresh = await sock.groupGetInviteInfo(code);
      size = Number(fresh?.size || 0);
      if (size > 0) info = { ...info, size };
    } catch {
      /* usa info original */
    }
  }
  if (code && size > 0) {
    pendingInvites.setInviteSize(code, size);
  }
  return info;
};

exports.sortQueueForProcessing = (queue) => pendingInvites.sortByMemberSize(queue);

exports.logTopInvites = (queue, max = 3) => {
  const top = (queue || []).slice(0, max);
  if (!top.length) return;
  const line = top
    .map((q) => `${q.meta?.subject || q.code.slice(0, 8)} (~${q.inviteSize || '?'})`)
    .join(' · ');
  debugLog(`Fila convites (maior primeiro): ${line}`);
};

module.exports = exports;
