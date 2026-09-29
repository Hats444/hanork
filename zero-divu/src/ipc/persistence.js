'use strict';

const cfg = require('../config/divulgacao');
const groupValidator = require('./groupValidator');
const pendingInvites = require('./pendingInvites');
const joinManager = require('./joinManager');
const groupOnboarding = require('./groupOnboarding');
const groupCache = require('./groupCache');
const runtimeRecovery = require('./runtimeRecovery');
const runtimeSnapshot = require('./runtimeSnapshot');
const timerRegistry = require('./timerRegistry');
const safe = require('../utils/safe');
const { infoLog, successLog } = require('../utils/logger');
const bootQuiet = require('../utils/bootQuiet');

/** Restaura fila de convites e reconcilia pedidos de entrada após reinício */
exports.resumeAfterBoot = async (sock) => {
  try {
    const store = require('../utils/debouncedStore');
    if (store.usingSql?.()) {
      const p = store.getSqlPath();
      const shared = p && /hanork\.db$/i.test(p);
      infoLog(`Persistência: SQLite (${p})${shared ? ' · compartilhado Hanork' : ''}`);
    } else {
      infoLog('Persistência: JSON (src/database/)');
    }
  } catch {
    /* ignore */
  }

  const recovery = await runtimeRecovery.run();
  timerRegistry.syncFromScheduler();

  await safe.runSilent('Reconciliar grupos (boot)', async () => {
    const registry = require('./socketRegistry');
    if (!registry.isOnline(sock) || registry.isRecentlyUnstable(120000)) {
      infoLog('Reconciliar grupos adiado — WhatsApp instável (próximo ciclo)');
      return;
    }
    const forbiddenCleanup = require('./forbiddenCleanup');
    const groupVacancy = require('./groupVacancy');
    try {
      await groupCache.getParticipating(sock, false);
    } catch {
      /* ignore */
    }
    const grupos = require('./grupos');
    let ghost = await grupos.reconcileGhostRegistry(sock);
    const orphanN =
      Object.keys(groupValidator.loadActiveGroups()).length -
      groupCache.countParticipatingGroups();
    if (orphanN > (cfg.GHOST_RECONCILE_MAX_CHECKS ?? 12) && ghost.dropped > 0) {
      ghost = await grupos.reconcileGhostRegistry(sock, {
        maxChecks: Math.min(orphanN + 3, 25),
      });
    }
    if (ghost.dropped > 0) {
      successLog(`${ghost.dropped} grupo(s) fantasma(s) removido(s) do registro no boot`);
    }

    if (groupCache.isSyncTrustworthy()) {
      await groupVacancy.reconcileMembership(sock);
      forbiddenCleanup.nudgeSavedInvites(sock);
    } else {
      bootQuiet.bootInfo(
        infoLog,
        'Sync parcial — reconciliação completa quando a lista WA estabilizar'
      );
      scheduleDeferredMembershipReconcile(sock);
    }
  });

  setTimeout(() => {
    safe.runSilent('Limpeza database (boot)', () => require('./databaseMaintenance').run(sock));
  }, cfg.DATABASE_MAINTENANCE_BOOT_DELAY_MS ?? 90000);

  try {
    const groupReclassify = require('./groupReclassify');
    for (const [jid, g] of Object.entries(groupValidator.loadActiveGroups())) {
      if (
        g.groupType === 'divulgacao' &&
        (g.classifyAction === 'stay_cautious' || g.postPermission === 'unknown')
      ) {
        groupReclassify.enqueue(jid);
      }
    }
  } catch {
    /* ignore */
  }

  const active = groupValidator.loadActiveGroups();
  let pendingApproval = 0;

  for (const [jid, g] of Object.entries(active)) {
    if (!g.pendingApproval) continue;
    pendingApproval++;

    const inWa = await groupCache.hasGroup(sock, jid);
    if (inWa) {
      groupValidator.registerGroup(jid, { pendingApproval: false });
      successLog(`Aprovação detectada (sync): ${g.subject || jid.split('@')[0]}`);
      await safe.runSilent('Aprovação (sync)', () => groupOnboarding.handleApproved(sock, jid));
    }
  }

  try {
    const pq = require('./persistentQueue');
    const maxKeep = cfg.RESUME_JOIN_CAP ?? 25;
    const cleaned = pq.sanitizeJoinJobs({ maxKeep });
    if (cleaned.removed > 0) {
      bootQuiet.bootInfo(
        infoLog,
        `Fila join: ${cleaned.removed} limpo(s) · ${cleaned.remaining} na fila (máx ${maxKeep})`
      );
    }
    pq.purgeFailed('join', 2 * 60 * 60 * 1000);
  } catch {
    /* ignore */
  }

  try {
    await require('./postGuard').markAnnounceOnlyBlocked(sock);
  } catch {
    /* ignore */
  }

  const queue = pendingInvites.listForProcessing();
  if (queue.length) {
    let joinQueued = new Set();
    try {
      joinQueued = new Set(
        require('./persistentQueue')
          .list('join')
          .map((j) => j.payload?.code)
          .filter(Boolean)
      );
    } catch {
      /* ignore */
    }

    const MAX_KEEP = cfg.RESUME_JOIN_CAP ?? 25;
    const already = joinQueued.size;
    const cap = Math.max(0, MAX_KEEP - already);
    const candidates = queue.filter((item) => !joinQueued.has(item.code));
    const toResume = cap > 0 ? candidates.slice(-cap) : [];
    if (toResume.length) {
      if (candidates.length > toResume.length) {
        bootQuiet.bootInfo(
          infoLog,
          `Retomando ${toResume.length}/${candidates.length} convite(s) do disco (cap ${MAX_KEEP})`
        );
      } else {
        bootQuiet.bootInfo(infoLog, `Retomando ${toResume.length} convite(s) do disco`);
      }
      for (const item of toResume) {
        await safe.runSilent('Convite retomado', () =>
          joinManager.enqueueInvite(sock, item.code, {
            ...item.meta,
            resumed: true,
            quiet: true,
          })
        );
      }
    } else if (queue.length) {
      bootQuiet.bootInfo(
        infoLog,
        `Convites: ${joinQueued.size} na fila join · ${queue.length} guardados em disco`
      );
    }
  }

  if (pendingApproval > 0) {
    infoLog(
      `${pendingApproval} grupo(s) com solicitação de entrada pendente — aguardando admin (registro persistido)`
    );
  }

  runtimeSnapshot.save({ boot: true, recoveryMode: recovery.recoveryMode });

  if (recovery.recoveryMode) {
    setTimeout(() => runtimeRecovery.clearRecoveryMode(), 30 * 60 * 1000);
  }

  return {
    pendingApproval,
    queuedInvites: queue.length,
    recoveryMode: recovery.recoveryMode,
    dueTimers: recovery.dueTimers,
  };
};

exports.resumeAfterReconnect = async (sock) => {
  timerRegistry.syncFromScheduler();

  try {
    require('./queueManager').reclaimAll();
  } catch {
    /* ignore */
  }

  for (const name of ['join', 'delivery', 'maintenance', 'cooldown', 'retry']) {
    try {
      require('./persistentQueue').reviveDueRetries(name);
      require('./persistentQueue').reclaimProcessing(name, 3 * 60 * 1000);
    } catch {
      /* ignore */
    }
  }

  runtimeSnapshot.save({ reconnect: true, at: new Date().toISOString() });
};

exports.shutdown = () => {
  pendingInvites.flush();
  try {
    timerRegistry.syncFromScheduler();
    runtimeSnapshot.save({ shutdown: true });
  } catch {
    /* ignore */
  }
  const store = require('../utils/debouncedStore');
  store.flushAll();
};

const RECONCILE_RETRY_MS = [45000, 120000, 300000];

function scheduleDeferredMembershipReconcile(sock) {
  let attempt = 0;
  const run = async () => {
    if (!sock) return;
    try {
      await groupCache.getParticipating(sock, true);
    } catch {
      /* ignore */
    }
    if (groupCache.isSyncTrustworthy()) {
      const forbiddenCleanup = require('./forbiddenCleanup');
      const groupVacancy = require('./groupVacancy');
      await groupVacancy.reconcileMembership(sock);
      forbiddenCleanup.nudgeSavedInvites(sock);
      successLog('Reconciliação de grupos concluída após sync estável');
      return;
    }
    attempt++;
    if (attempt < RECONCILE_RETRY_MS.length) {
      setTimeout(run, RECONCILE_RETRY_MS[attempt]);
    } else {
      infoLog('Sync ainda parcial — limpando fantasmas confirmados (última tentativa)');
      try {
        const out = await require('./grupos').reconcileGhostRegistry(sock, {
          maxChecks: cfg.GHOST_RECONCILE_MAX_CHECKS ?? 15,
        });
        if (out.dropped > 0) {
          successLog(`${out.dropped} fantasma(s) removido(s) após espera de sync`);
        }
      } catch {
        /* ignore */
      }
    }
  };
  setTimeout(run, RECONCILE_RETRY_MS[0]);
}

module.exports = exports;