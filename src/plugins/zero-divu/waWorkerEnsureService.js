'use strict';

/**
 * Always-On Universal v5i — ensure worker IPC + WA session healthy.
 * Admin: shared/zero-ipc (wa_a) · shared/zero-ipc-b (wa_b)
 * Subscriber: ~/.hanork/wa-users/{id}/ipc (never cross-kill — §6.5)
 */

async function ensureWaSessionHealthy(scope, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 45000;

  if (scope?.kind === 'admin' || scope?.sessionId) {
    const { ensureBothAdminWorkers, ensureSessionWorker, readSessionHealth, tryReconnectSession } =
      require('./spawnZeroWorker');
    const sessionId = scope.sessionId || null;

    if (!sessionId || opts.both !== false) {
      return ensureBothAdminWorkers(opts.adminId ?? null, timeoutMs);
    }

    ensureSessionWorker(sessionId);
    const health = readSessionHealth(sessionId);
    if (health.hasCreds && health.workerAlive && !health.connected) {
      await tryReconnectSession(sessionId, opts.adminId ?? null);
    }
    return { ok: health.workerAlive, health };
  }

  if (scope?.kind === 'subscriber' || scope?.telegramId) {
    const { _ensureWorkerReady } = require('../../modules/wa-divulgacao/waDivulgacaoWorkerService');
    return _ensureWorkerReady(scope.telegramId, {
      maxWaitMs: timeoutMs,
      maxPings: opts.maxPings ?? 3,
    });
  }

  return { ok: false, reason: 'invalid_scope' };
}

function ensureBothAdminWorkers(adminId = null, timeoutMs = 45000) {
  const { ensureBothAdminWorkers: ensure } = require('./spawnZeroWorker');
  return ensure(adminId, timeoutMs);
}

module.exports = {
  ensureWaSessionHealthy,
  ensureBothAdminWorkers,
};
