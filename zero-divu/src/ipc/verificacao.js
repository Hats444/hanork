'use strict';

const cfg = require('../config/divulgacao');
const operationalLimits = require('./operationalLimits');
const grupos = require('./grupos');
const postagem = require('./postagem');
const monitor = require('./monitor');
const safeMode = require('./safeMode');
const activeHours = require('../utils/activeHours');
const antiBan = require('./antiBan');
const logThrottle = require('../utils/logThrottle');
const safe = require('../utils/safe');
const cycleLock = require('../utils/cycleLock');
const startupCatchup = require('./startupCatchup');
const schedulerClock = require('../utils/schedulerClock');
const operationContext = require('../utils/operationContext');
const processRuntime = require('./processRuntime');
const { infoLog, successLog, warningLog, section, opLog } = require('../utils/logger');
const bootQuiet = require('../utils/bootQuiet');

let postLoopTimer = null;
let cleanupTimer = null;
let monitorTimer = null;
let reclassifyTimer = null;
let pendingReclassifyTimer = null;
let started = false;

async function executePostCycle(sock, label) {
  return operationContext.withOp('cycle', { source: label, queue: 'delivery' }, async (opId) => {
  const cycleStarted = Date.now();
  schedulerClock.onCycleStart(label);

  if (safeMode.isPaused()) {
    if (logThrottle.shouldLog('safe-mode')) warningLog('Modo seguro ativo — divulgação suspensa');
    schedulerClock.onCycleEnd(label, 0, 0, cycleStarted);
    return 0;
  }

  try {
    if (require('../ipc/runtimeControls').isPostsPaused()) {
      if (logThrottle.shouldLog('admin-pause')) {
        infoLog('Postagens pausadas pelo admin (Telegram)');
      }
      schedulerClock.onCycleEnd(label, 0, 0, cycleStarted);
      return 0;
    }
  } catch {
    /* IPC opcional */
  }

  try {
    const promo = await require('../ipc/promoQueue').processNextIfAny(sock);
    if (promo?.processed) {
      successLog(
        `Promo Hanork · ${promo.productName || promo.jobId} · ${promo.sent} envio(s)`
      );
      schedulerClock.onCycleEnd(label, promo.sent, promo.sent, cycleStarted);
      return promo.sent;
    }
  } catch (e) {
    warningLog(`Fila promo: ${e?.message || e}`);
  }

  if (!activeHours.isActiveNow()) {
    if (logThrottle.shouldLog('fora-horario')) infoLog('Fora do horário configurado');
    schedulerClock.onCycleEnd(label, 0, 0, cycleStarted);
    return 0;
  }

  if (!antiBan.canPostNow()) {
    const lim = antiBan.getLimits();
    const pause = require('./riskController').getPauseInfo();
    if (logThrottle.shouldLog('limite-posts-hora')) {
      if (pause.hardPaused) {
        warningLog(
          `Postagens pausadas (anti-ban ~${pause.remainingMin} min, risco ${pause.riskScore}/100)`
        );
      } else {
        warningLog(`Cota horária de posts (${lim.posts}/${lim.maxPosts})`);
      }
    }
    schedulerClock.onCycleEnd(label, 0, 0, cycleStarted);
    return 0;
  }

  const ids = grupos.getEligibleGroupIds();

  if (!ids.length) {
    if (logThrottle.shouldLog('sem-grupos')) infoLog('Nenhum grupo elegível para divulgação');
    schedulerClock.onCycleEnd(label, 0, 0, cycleStarted);
    return 0;
  }

  section(`Ciclo ${label}`);
  infoLog(`Enviando status em ${ids.length} grupo(s) de divulgação`);

  const sent = await postagem.runPostCycle(sock, ids);
  monitor.inc('postsSent', sent);

  if (sent > 0) {
    safeMode.recordSuccess();
    successLog(`Ciclo finalizado: ${sent}/${ids.length} envio(s)`);
  } else {
    safeMode.recordFail();
    warningLog('Ciclo sem envios concluídos — verifique AVISO/ERRO acima');
  }

  schedulerClock.onCycleEnd(label, sent, ids.length, cycleStarted);
  schedulerClock.renderCompact();

  try {
    require('./runtimeSnapshot').save({ lastCycle: label, sent });
    require('./metrics').recordDelay(Date.now() - cycleStarted);
  } catch {
    /* ignore */
  }

  opLog(sent > 0 ? 'OK' : 'AVISO', `Ciclo ${label}: ${sent}/${ids.length}`, {
    opId,
    source: label,
    queue: 'delivery',
    ms: Date.now() - cycleStarted,
  });

  try {
    await require('./autoProfile').maybeAdjustAfterCycle({ sent, total: ids.length });
  } catch {
    /* ignore */
  }

  return sent;
  });
}

exports.runScheduledPost = async (sock, label = 'automático') => {
  return executePostCycle(sock, label);
};

function schedulePostLoop(sock) {
  const groupEventScheduler = require('./groupEventScheduler');
  if (groupEventScheduler.isEnabled()) return;

  if (postLoopTimer) clearTimeout(postLoopTimer);

  const distributed = require('./distributedScheduler');
  const useDistributed = distributed.isEnabled();
  const intervalMs = useDistributed ? distributed.computeNextWakeMs() : cfg.POST_INTERVAL;
  schedulerClock.schedulePeriodic(Date.now() + intervalMs);

  postLoopTimer = setTimeout(async () => {
    const label = useDistributed ? 'distribuído' : 'periódico';
    await safe.run(`Ciclo ${label}`, () => exports.runScheduledPost(sock, label));
    schedulePostLoop(sock);
  }, intervalMs);
}

exports.startSchedulers = (sock, opts = {}) => {
  if (started) return;
  started = true;

  const intervalMin = Math.round(cfg.POST_INTERVAL / 60000);
  const firstDelay =
    cfg.STARTUP_FIRST_POST_DELAY_MS ?? operationalLimits.getFirstPostDelayMs();
  const sec = Math.round(firstDelay / 1000);
  const isReconnect = opts.reconnect === true || processRuntime.isReconnectBoot();
  const eventDriven = (() => {
    try {
      return require('./groupEventScheduler').isEnabled();
    } catch {
      return false;
    }
  })();
  const runCatchup =
    cfg.POST_ON_START !== false &&
    cfg.STARTUP_CATCHUP_ENABLED !== false &&
    (eventDriven ? cfg.STARTUP_CATCHUP_EVENT_DRIVEN !== false : true) &&
    (cfg.RECONNECT_SKIP_CATCHUP !== false ? !isReconnect : true) &&
    processRuntime.shouldRunStartupCatchup();

  if (runCatchup) {
    const warmupNote = operationalLimits.isWarmupActive() ? ' (warm-up)' : '';
    const startupAt = Date.now() + firstDelay;
    schedulerClock.scheduleStartup(startupAt);
    bootQuiet.bootInfo(
      infoLog,
      `Divulgação ao iniciar em ~${sec}s — grupos sem post recente primeiro${warmupNote}`
    );
    setTimeout(async () => {
      let sent = 0;
      if (eventDriven) {
        try {
          sent = require('./groupEventScheduler').primeDueGroups() || 0;
        } catch {
          /* ignore */
        }
        if (sent > 0) {
          successLog(`Boot: ${sent} grupo(s) agendado(s) — scheduler event-driven (1 GP por vez)`);
        }
      } else {
        const catchupSent = await safe.run('Sincronização inicial', () => startupCatchup.run(sock));
        sent += catchupSent || 0;
        if (sent > 0) {
          successLog(`Boot: ${sent} status enviado(s) — ciclo normal continua nos demais grupos`);
        }
      }
      schedulerClock.clearStartup();
    }, firstDelay);
  } else if (isReconnect) {
    bootQuiet.bootInfo(infoLog, 'Reconnect — catchup inicial ignorado');
    schedulerClock.clearStartup();
    if (eventDriven) {
      const warmupMs =
        cfg.CONNECTION_WARMUP_MS > 0
          ? cfg.CONNECTION_WARMUP_MS
          : parseInt(process.env.CONNECTION_WARMUP_MS || '0', 10) ||
            (process.env.HANORK_ZERO_WORKER === '1' ? 120000 : 60000);
      setTimeout(() => {
        try {
          if (require('./socketRegistry').isOnline(sock)) {
            require('./groupEventScheduler').primeDueGroups?.();
          }
        } catch {
          /* ignore */
        }
      }, warmupMs);
    }
  } else if (eventDriven) {
    bootQuiet.bootInfo(infoLog, 'Scheduler event-driven — timers por grupo ativos');
    schedulerClock.clearStartup();
    const warmupMs =
      cfg.CONNECTION_WARMUP_MS > 0
        ? cfg.CONNECTION_WARMUP_MS
        : parseInt(process.env.CONNECTION_WARMUP_MS || '0', 10) ||
          (process.env.HANORK_ZERO_WORKER === '1' ? 120000 : 0);
    const prime = () => {
      try {
        if (require('./socketRegistry').isOnline(sock)) {
          require('./groupEventScheduler').primeDueGroups?.();
        }
      } catch {
        /* ignore */
      }
    };
    if (warmupMs > 0) {
      setTimeout(prime, warmupMs);
    } else {
      prime();
    }
  }

  schedulePostLoop(sock);
  schedulerClock.startTicker();

  try {
    require('../ipc/promoQueue').startScheduler();
  } catch {
    /* ignore */
  }

  try {
    const groupEventScheduler = require('./groupEventScheduler');
    if (groupEventScheduler.isEnabled()) {
      groupEventScheduler.start(sock, { silent: true });
    }
  } catch {
    /* ignore */
  }

  const distributed = require('./distributedScheduler');
  const groupEventScheduler = require('./groupEventScheduler');
  if (groupEventScheduler.isEnabled()) {
    bootQuiet.bootInfo(
      infoLog,
      `Scheduler event-driven: 1 GP/grupo · safety ${Math.round((cfg.SCHEDULER_SAFETY_POLL_MS ?? 1800000) / 60000)} min`
    );
  } else if (distributed.isEnabled()) {
    bootQuiet.bootInfo(
      infoLog,
      `Scheduler distribuído: ${distributed.maxGroupsPerWake()} GP/wake · ${distributed.describeNextWake()}`
    );
  } else {
    const intervalMinLoop = Math.round(cfg.POST_INTERVAL / 60000);
    bootQuiet.bootInfo(infoLog, `Agendamento: ciclo a cada ${intervalMinLoop} min`);
  }

  const cleanup = require('./cleanup');
  const groupReclassify = require('./groupReclassify');

  cleanupTimer = setInterval(
    () => safe.runSilent('Limpeza automática', () => cleanup.run(sock)),
    cfg.CLEANUP_INTERVAL_MS
  );
  monitorTimer = setInterval(() => monitor.tick(), cfg.MONITOR_INTERVAL_MS);

  if (cfg.ENABLE_AUTO_RECLASSIFY) {
    const reclassifyH = Math.round((cfg.GROUP_RECLASSIFY_INTERVAL_MS || 7200000) / 3600000);
    bootQuiet.bootInfo(
      infoLog,
      `Reclassificação automática a cada ${reclassifyH}h`
    );
    reclassifyTimer = setInterval(
      () => safe.runSilent('Reclassificação', () => grupos.runReclassificationCycle(sock)),
      cfg.GROUP_RECLASSIFY_INTERVAL_MS || 2 * 60 * 60 * 1000
    );
    pendingReclassifyTimer = setInterval(
      () => safe.runSilent('Reclassificação pendente', () => groupReclassify.flushPending(sock)),
      60000
    );
  }

  const optimizerInterval = cfg.GROUP_OPTIMIZER_INTERVAL_MS ?? 20 * 60 * 1000;
  const groupOptimizer = require('./groupOptimizer');
  setInterval(
    () => safe.runSilent('Otimizador de grupos', () => groupOptimizer.tick(sock)),
    optimizerInterval
  );
};

exports.stopSchedulers = () => {
  started = false;
  schedulerClock.stopTicker();
  try {
    require('../ipc/promoQueue').stopScheduler();
  } catch {
    /* ignore */
  }
  try {
    require('./groupEventScheduler').stop();
  } catch {
    /* ignore */
  }
  if (postLoopTimer) clearTimeout(postLoopTimer);
  if (cleanupTimer) clearInterval(cleanupTimer);
  if (monitorTimer) clearInterval(monitorTimer);
  if (reclassifyTimer) clearInterval(reclassifyTimer);
  if (pendingReclassifyTimer) clearInterval(pendingReclassifyTimer);
  postLoopTimer = cleanupTimer = monitorTimer = reclassifyTimer = pendingReclassifyTimer = null;
  cycleLock.forceReset('stop schedulers');

  const groupReclassify = require('./groupReclassify');
  if (typeof groupReclassify.forceReset === 'function') {
    groupReclassify.forceReset();
  }
};

module.exports = exports;
