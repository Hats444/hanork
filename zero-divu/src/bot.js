'use strict';

const conviteHandler = require('./services/conviteHandler');
const grupos = require('./services/grupos');
const verificacao = require('./services/verificacao');
const monitor = require('./services/monitor');
const groupValidator = require('./services/groupValidator');
const blacklist = require('./services/blacklist');
const groupCache = require('./services/groupCache');
const cfg = require('./config/divulgacao');
const operationalLimits = require('./services/operationalLimits');
const warmup = require('./services/warmup');
const persistence = require('./services/persistence');
const pendingInvites = require('./services/pendingInvites');
const env = require('./utils/environmentDetector');
const deps = require('./utils/dependencyManager');
const memoryProfile = require('./utils/memoryProfile');
const safe = require('./utils/safe');
const cycleLock = require('./utils/cycleLock');
const floodGuard = require('./services/floodGuard');
const schedulerClock = require('./utils/schedulerClock');
const {
  successLog,
  infoLog,
  errorLog,
  warningLog,
  section,
  summary,
  banner,
} = require('./utils/logger');

let bootstrapped = false;
let pausedForReconnect = false;
let groupsSyncTimer = null;
let boundSock = null;

function bindSocketEvents(sock) {
  if (!sock?.ev || boundSock === sock) return;
  boundSock = sock;

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      await safe.run('Convite', () => conviteHandler.handleMessage(sock, msg));
    }
  });

  sock.ev.on('groups.update', async (updates) => {
    const manualJoinRealtime = require('./services/manualJoinRealtime');
    await safe.runSilent('Manual join (groups.update)', () =>
      manualJoinRealtime.onGroupsUpdate(sock, updates)
    );
    debounceGroupsSync(sock);
  });

  sock.ev.on('group-participants.update', async (event) => {
    await safe.run('Manual join (participants)', () =>
      require('./services/manualJoinRealtime').onParticipantUpdate(sock, event)
    );
  });

}

function debounceGroupsSync(sock) {
  if (groupsSyncTimer) clearTimeout(groupsSyncTimer);
  groupsSyncTimer = setTimeout(async () => {
    await safe.runSilent('Sync grupos (debounce)', () => grupos.syncGroupsFromWhatsApp(sock, false));
    const groupReclassify = require('./services/groupReclassify');
    await safe.runSilent('Reclassificar pendentes', () => groupReclassify.flushPending(sock));
  }, cfg.GROUPS_UPDATE_DEBOUNCE_MS || 300000);
}

exports.start = async (sock, opts = {}) => {
  if (bootstrapped && !opts.reconnect && !pausedForReconnect) {
    infoLog('Serviços já em execução');
    return true;
  }

  if (bootstrapped && (opts.reconnect || pausedForReconnect)) {
    exports.stop();
    bootstrapped = false;
    pausedForReconnect = false;
  }

  const bootQuiet = require('./utils/bootQuiet');
  if (!bootQuiet.isQuiet()) bootQuiet.enter(120000);

  banner();
  if (!process.env.ZERO_DIVU_IPC_DIR && !process.env.HANORK_ZERO_WORKER) {
    section('Inicialização');
  }

  const runtime = env.get();
  infoLog(`Ambiente: ${deps.logSummary()} · memória: ${memoryProfile.getProfileName()}`);
  const bootHint = env.getBootHint?.();
  if (bootHint) infoLog(bootHint);
  require('./services/processManager').logOnBoot();

  try {
    bindSocketEvents(sock);
    try {
      require('./services/socketRegistry').setPaused(false);
    } catch {
      /* ignore */
    }
    warmup.ensureStarted();
    floodGuard.reset();

    await safe.run('Sync grupos inicial', async () => {
      const socketRegistry = require('./services/socketRegistry');
      if (socketRegistry.isWarmingUp()) {
        const wait = socketRegistry.warmupRemainingMs() + 2000;
        infoLog(`Sync de grupos adiado ${Math.round(wait / 1000)}s (estabilização da conexão)`);
        await new Promise((r) => setTimeout(r, wait));
      }
      if (!socketRegistry.isOnline(sock) || socketRegistry.isRecentlyUnstable(120000)) {
        warningLog('Sync inicial adiado — conexão ainda estabilizando (usa cache)');
        return;
      }
      try {
        await grupos.syncGroupsFromWhatsApp(sock, true);
      } catch (e) {
        const eStr = String(e?.message || e);
        if (/rate-overlimit|overlimit|429/i.test(eStr)) {
          warningLog('Rate limit no boot — tentando sync leve em 20s…');
          await new Promise((r) => setTimeout(r, 20000));
          await grupos.syncGroupsFromWhatsApp(sock, false);
        } else if (/connection closed|connection was lost|stream errored/i.test(eStr)) {
          warningLog('Conexão instável no sync inicial — usando cache (sincroniza no próximo ciclo)');
        } else {
          throw e;
        }
      }
    });

    for (const [jid, g] of Object.entries(groupValidator.loadActiveGroups())) {
      if (g.groupType === 'divulgacao' && (!g.classifyAction || !g.postPermission)) {
        const open =
          cfg.GROUP_CLASSIFY_EMPTY_DESC_AS_DIVULG === true ||
          cfg.GROUP_CLASSIFY_REQUIRE_EXPLICIT_ALLOW === false;
        groupValidator.registerGroup(jid, {
          classifyAction: g.classifyAction || (open ? 'stay' : 'stay_cautious'),
          postPermission: g.postPermission || (open ? 'allowed' : 'unknown'),
          classifyPendingVerify: !g.classifiedAt && !open,
        });
      }
    }

    try {
      require('./services/mediaBootstrap').ensureHanorkMedia();
    } catch {
      /* ignore */
    }

    try {
      const syncHealth = require('./services/syncHealth');
      infoLog(syncHealth.describe());
    } catch {
      /* ignore */
    }

    await persistence.resumeAfterBoot(sock);

    try {
      const healed = require('./services/postGuard').healForbiddenPending();
      if (healed > 0) {
        require('./services/forbiddenCleanup').nudgeSavedInvites(sock);
      }
    } catch {
      /* ignore */
    }

    const active = groupValidator.loadActiveGroups();
    const awaitingAdmin = Object.values(active).filter((g) => g.pendingApproval).length;
    const divu = grupos.getActiveGroupIds().length;
    const distributedScheduler = require('./services/distributedScheduler');
    const snap = operationalLimits.snapshot();
    const w = snap.warmup;
    const cap = snap.effective.maxGroupsPerCycle;
    const cycleLabel = distributedScheduler.isEnabled()
      ? `distribuído · ${distributedScheduler.maxGroupsPerWake()} GP/wake · nextPostAt`
      : `a cada ${Math.round(cfg.POST_INTERVAL / 60000)} min`;

    summary([
      ['Conta', sock.user?.id?.split(':')[0] || 'conectada'],
      ['Perfil operacional', `${snap.profileLabel} (${snap.profile})`],
      [
        'Warm-up',
        w.active ? `ativo — ${w.percent}% (~${w.remainingHours}h restantes)` : 'concluído',
      ],
      ['Grupos de divulgação', String(divu)],
      ['Aguardando aprovação', String(awaitingAdmin)],
      ['Convites na fila (disco)', String(pendingInvites.count())],
      ['Grupos no total', String(Object.keys(active).length)],
      ['Limite de grupos', String(snap.effective.maxGroups)],
      ['Posts/hora (efetivo)', String(snap.effective.maxPostsPerHour)],
      ['Entradas/hora (efetivo)', String(snap.effective.maxJoinsPerHour)],
      ['Grupos por ciclo', distributedScheduler.isEnabled() ? String(distributedScheduler.maxGroupsPerWake()) : String(cap)],
      [
        'Envio',
        (() => {
          try {
            return require('./services/statusMessage').mirrorToChatEnabled()
              ? 'Status + chat (espelho após OK)'
              : 'somente Status do grupo';
          } catch {
            return 'somente Status do grupo';
          }
        })(),
      ],
      ['Ciclo de status', cycleLabel],
      ['Intervalo por grupo', `${cfg.MIN_GROUP_POST_INTERVAL_MS / 3600000}–${(cfg.MAX_GROUP_POST_INTERVAL_MS || cfg.MIN_GROUP_POST_INTERVAL_MS) / 3600000}h (aleatório)`],
      ['Limite por grupo', `${cfg.MAX_POSTS_PER_GROUP_PER_24H ?? 2}/24h (janela deslizante)`],
      [
        'Entre grupos no ciclo',
        `${Math.round((cfg.INTER_GROUP_DELAY_MS_MIN ?? cfg.STATUS_DELAY_MIN) / 1000)}–${Math.round((cfg.INTER_GROUP_DELAY_MS_MAX ?? cfg.STATUS_DELAY_MAX) / 1000)}s`,
      ],
      ['Post ao entrar', cfg.AUTO_POST_ON_JOIN ? 'sim (se passar na verificação)' : 'desligado'],
      [
        'Classificador',
        cfg.ENABLE_GROUP_CLASSIFIER
          ? cfg.GROUP_CLASSIFY_REQUIRE_EXPLICIT_ALLOW !== false
            ? 'rigoroso — só divulga com liberação explícita nas regras'
            : 'ativo'
          : 'desligado',
      ],
      [
        'Reclassificação auto',
        cfg.ENABLE_AUTO_RECLASSIFY
          ? `a cada ${Math.round((cfg.GROUP_RECLASSIFY_INTERVAL_MS || 7200000) / 3600000)}h`
          : 'desligada',
      ],
    ]);

    if (opts.reconnect) {
      setTimeout(() => {
        safe.runSilent('Reclassificação pós-reconnect', () =>
          require('./services/groupReclassify').flushPending(sock)
        );
      }, 30000);
    } else {
      setTimeout(() => {
        safe.run('Classificação inicial', () => grupos.classifyExistingGroups(sock));
      }, 5000);
    }

    schedulerClock.onBoot();
    require('./services/queueManager').startAll(sock);
    verificacao.startSchedulers(sock, opts);
    require('./services/processSupervisor').start();
    monitor.tick({ full: true });

    if (opts.reconnect) {
      setTimeout(() => {
        try {
          require('./services/processRuntime').clearBootType();
        } catch {
          /* ignore */
        }
      }, 60000);
    }

    bootstrapped = true;
    pausedForReconnect = false;
    bootQuiet.exit(infoLog);
    return true;
  } catch (e) {
    try {
      require('./utils/bootQuiet').exit();
    } catch {
      /* ignore */
    }
    errorLog(`Falha na inicialização: ${safe.formatErr(e)}`);
    bootstrapped = false;
    cycleLock.forceReset('init failed');
    try {
      require('./services/verificacao').stopSchedulers();
    } catch {
      /* ignore */
    }
    throw e;
  }
};

/** Pausa leve para reconnect — não derruba filas nem exibe shutdown completo */
exports.pause = () => {
  if (!bootstrapped || pausedForReconnect) return;
  pausedForReconnect = true;
  boundSock = null;

  try {
    require('./services/socketRegistry').setPaused(true);
  } catch {
    /* ignore */
  }

  try {
    require('./services/queueManager').freeze();
  } catch {
    /* ignore */
  }

  schedulerClock.stopTicker();
  verificacao.stopSchedulers();
  cycleLock.forceReset('reconnect pause');

  try {
    require('./services/groupReclassify').pause();
  } catch {
    /* ignore */
  }

  try {
    require('./services/checkpoints').record('before_reconnect_pause', {});
    require('./services/runtimeSnapshot').save({ reconnectPause: true });
    require('./utils/debouncedStore').flushAll();
  } catch {
    /* ignore */
  }

  infoLog('Conexão pausada — aguardando reconnect (estado preservado)');
};

exports.resume = async (sock, opts = {}) => {
  if (!bootstrapped && !pausedForReconnect) {
    return exports.start(sock, opts);
  }

  bindSocketEvents(sock);
  require('./services/socketRegistry').register(sock);
  try {
    require('./services/socketRegistry').setPaused(false);
  } catch {
    /* ignore */
  }
  groupCache.invalidate();

  try {
    require('./services/queueManager').reclaimAll();
    if (!require('./services/socketRegistry').isWarmingUp()) {
      require('./services/queueManager').unfreeze();
    }
  } catch {
    /* ignore */
  }

  await persistence.resumeAfterReconnect(sock);

  const processRuntime = require('./services/processRuntime');
  processRuntime.markReconnect();

  verificacao.startSchedulers(sock, { reconnect: true });
  require('./services/processSupervisor').start();
  schedulerClock.startTicker();
  monitor.tick({ full: false });

  pausedForReconnect = false;
  successLog('Serviços retomados após reconnect (sem reboot completo)');

  setTimeout(() => {
    safe.runSilent('Reclassificação pós-reconnect', () =>
      require('./services/groupReclassify').flushPending(sock)
    );
  }, 45000);

  return true;
};

exports.stop = () => {
  if (!bootstrapped && !pausedForReconnect) return;
  bootstrapped = false;
  pausedForReconnect = false;
  boundSock = null;
  schedulerClock.stopTicker();
  verificacao.stopSchedulers();
  try {
    require('./services/queueManager').stopAll();
  } catch {
    /* ignore */
  }
  try {
    require('./services/postagem').stopWorkers();
  } catch {
    /* ignore */
  }
  try {
    require('./services/processSupervisor').stop();
  } catch {
    /* ignore */
  }
  if (groupsSyncTimer) clearTimeout(groupsSyncTimer);
  persistence.shutdown();
  blacklist.flush();
  infoLog('Estado salvo em database/ — serviços encerrados');
};

exports.isRunning = () => bootstrapped && !pausedForReconnect;
exports.isPaused = () => pausedForReconnect;
exports.canSoftResume = () => bootstrapped && pausedForReconnect;

module.exports = exports;
