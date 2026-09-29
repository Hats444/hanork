'use strict';

const { getZeroDivuClient } = require('./ZeroDivuClient');
const { listSpawnableSessions, resolveSession, isDualWaEnabled } = require('./waSessionsManifest');
const { mutateWa } = require('./waIpcHelper');

async function runOverlapCleanupAll(adminId, opts = {}) {
  if (!isDualWaEnabled()) {
    return { ok: false, message: 'Dual WA desligado — repor alcance só com 2 números ativos.' };
  }

  const timeoutMs = opts.timeoutMs || 120000;
  const lines = [];

  for (const sessionId of listSpawnableSessions()) {
    const client = getZeroDivuClient(sessionId);
    const label = resolveSession(sessionId).displayName;
    const ack = await mutateWa(client, 'wa.overlap_cleanup', {}, adminId, { timeoutMs });

    if (!ack?.ok) {
      lines.push(`${label}: ${ack?.message || ack?.error || 'offline'}`);
      continue;
    }

    const r = ack.result?.result || ack.result || {};
    const refillN = r.refill?.enqueued ?? 0;
    let refillNote = '';
    if (refillN > 0) refillNote = ` · ${refillN} convite(s) na fila`;
    else if (r.refill?.reason === 'auto_join_off') refillNote = ' · ligue Auto-join';
    else if (r.refill?.reason === 'at_cap') refillNote = ' · limite de grupos cheio';

    lines.push(
      `${label}: ${r.overlaps ?? 0} em comum · ${r.left ?? 0} saída(s)${refillNote}`
    );
  }

  return { ok: true, lines };
}

function formatOverlapPanelText(lines) {
  return (
    '<b>Repor alcance — dual WA</b>\n\n' +
    'O bot <b>secundário (WA 2)</b> sai de grupos onde os dois estão.\n' +
    'O <b>WA 1</b> fica no grupo em comum.\n' +
    'Depois o WA 2 entra em <b>novo grupo</b> da fila (auto-join).\n\n' +
    lines.map((l) => `• ${l}`).join('\n') +
    '\n\n<i>Verificação automática a cada ~10 min. Auto-join precisa estar ON.</i>'
  );
}

module.exports = {
  runOverlapCleanupAll,
  formatOverlapPanelText,
};
