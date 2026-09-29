'use strict';

const fs = require('fs-extra');
const path = require('path');
const { getZeroDivuClient } = require('./ZeroDivuClient');
const { listSpawnableSessions, isDualWaEnabled, DEFAULT_PRIMARY } = require('./waSessionsManifest');

/**
 * Sessões alvo para promo automática / campanha WA.
 * Com dual ativo: todos os workers admin (mesma copy, grupos exclusivos por bot).
 */
function listPromoTargetSessions(opts = {}) {
  if (opts.sessionId) return [opts.sessionId];
  if (process.env.WA_BLAST_PRIMARY_ONLY === '1' || process.env.WA_PROMO_PRIMARY_ONLY === '1') {
    return [listSpawnableSessions()[0] || DEFAULT_PRIMARY];
  }
  if (isDualWaEnabled()) return listSpawnableSessions();
  return [listSpawnableSessions()[0] || DEFAULT_PRIMARY];
}

async function stageBufferToAllInboxes(buffer, fileName) {
  if (!buffer?.length) return null;
  const stagingName = fileName || `promo-${Date.now()}.jpg`;
  for (const sessionId of listPromoTargetSessions()) {
    const client = getZeroDivuClient(sessionId);
    client.ensureDir();
    const inbox = path.join(client.ipcDir, 'inbox');
    fs.ensureDirSync(inbox);
    await fs.writeFile(path.join(inbox, stagingName), buffer);
  }
  return stagingName;
}

function scheduleDelayedProcessPromo(client, adminId, delayMs, logger) {
  if (!(delayMs > 0)) return;
  setTimeout(() => {
    client.sendCommand('wa.process_promo', {}, adminId).then((proc) => {
      if (!proc?.ok && logger) {
        const errMsg = String(proc?.message || proc?.error || '').trim();
        const benign = /fila promo vazia|queue empty|already processed|nada na fila/i.test(errMsg);
        const logFn = benign ? logger.info?.bind(logger) : logger.warn?.bind(logger);
        logFn?.('[WA promo] process_promo atrasado', {
          module: 'WA',
          error: errMsg || 'falha',
          benign,
        });
      }
    }).catch((e) => {
      logger?.debug?.('[WA promo] process_promo atrasado erro', { module: 'WA', error: e?.message });
    });
  }, delayMs + 8000);
}

/**
 * Enfileira o mesmo payload de promo em cada sessão WA (idempotencyKey sufixada por sessão).
 */
async function enqueuePromoOnAllSessions(adminId, buildEnqueueArgs, opts = {}) {
  const sessions = listPromoTargetSessions(opts);
  const delayMs = Math.max(0, Number(opts.delayMs) || 0);
  const baseKey = opts.idempotencyKey || `promo-${adminId || 'system'}-${Date.now()}`;
  const logger = opts.logger || null;
  const results = [];

  for (const sessionId of sessions) {
    const client = getZeroDivuClient(sessionId);
    const enqueueArgs = buildEnqueueArgs({ sessionId });
    const idempotencyKey = sessions.length > 1 ? `${baseKey}-${sessionId}` : baseKey;

    const ack = await client.sendCommand(
      'wa.enqueue_promo',
      { ...enqueueArgs, idempotencyKey, delayMs },
      adminId
    );

    const entry = {
      sessionId,
      ok: Boolean(ack?.ok),
      message: ack?.message || ack?.error || null,
    };

    if (ack?.ok) {
      const r = ack.result?.result || ack.result || {};
      entry.jobId = r.jobId;
      entry.pending = r.pending;
      entry.hasImage = r.hasImage;
      entry.duplicate = Boolean(r.duplicate);
      entry.processAfter = r.processAfter || null;
      entry.delayMs = r.delayMs ?? delayMs;

      if (opts.processNow === true && delayMs <= 0) {
        const proc = await client.sendCommand('wa.process_promo', {}, adminId).catch(() => null);
        if (proc?.ok) {
          const pr = proc.result?.result || proc.result || {};
          entry.processed = true;
          entry.sent = pr.sent;
        }
      } else if (delayMs > 0 && entry.jobId) {
        scheduleDelayedProcessPromo(client, adminId, delayMs, logger);
      }
    }

    results.push(entry);
  }

  const ok = results.some((r) => r.ok);
  const primary = results.find((r) => r.ok) || results[0] || {};
  return {
    ok,
    offline: !ok,
    sessions: results,
    sessionIds: sessions,
    sentTotal: results.reduce((sum, r) => sum + (Number(r.sent) || 0), 0),
    ...primary,
  };
}

module.exports = {
  listPromoTargetSessions,
  stageBufferToAllInboxes,
  enqueuePromoOnAllSessions,
};
