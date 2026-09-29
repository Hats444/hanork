'use strict';

const cfg = require('../config/divulgacao');
const groupScheduler = require('./groupScheduler');
const groupValidator = require('./groupValidator');
const groupClassifier = require('./groupClassifier');
const groupHealth = require('./groupHealth');
const postGuard = require('./postGuard');
const timerRegistry = require('./timerRegistry');
const { humanDelay } = require('../utils/humanDelay');
const { randomInt } = require('../utils/random');
const { infoLog } = require('../utils/logger');
const logThrottle = require('../utils/logThrottle');
const bootQuiet = require('../utils/bootQuiet');

const timers = new Map();
let sockRef = null;
let safetyTimer = null;
let started = false;
let staggerIndex = 0;
let postChain = Promise.resolve();

function listCandidates() {
  const list = groupValidator.listSortedByScore();
  let out = list;
  if (cfg.ENABLE_GROUP_CLASSIFIER) {
    out = out.filter((g) => groupClassifier.isEligibleForCycle(g));
  }
  return require('./groupMembership').filterInWhatsApp(out);
}

function computeDelayMs(jid, st) {
  if (!st?.nextPostAt) return humanDelay(8000, 25000);
  const delta = new Date(st.nextPostAt).getTime() - Date.now();
  if (delta <= 0) {
    const slotMs = cfg.SCHEDULER_CATCHUP_STAGGER_MS ?? 90000;
    const slot = staggerIndex * randomInt(Math.round(slotMs * 0.8), slotMs);
    staggerIndex = Math.min(staggerIndex + 1, 30);
    return humanDelay(5000, 15000) + slot;
  }
  let delay = delta + randomInt(5000, 35000);
  try {
    delay = Math.round(delay * require('./runtimeRecovery').getRecoveryDelayFactor());
  } catch {
    /* ignore */
  }
  return Math.min(delay, cfg.SCHEDULER_EVENT_MAX_DELAY_MS ?? 24 * 60 * 60 * 1000);
}

async function fireGroupPost(jid) {
  if (!sockRef || require('./gracefulShutdownManager').isShuttingDown()) return;

  try {
    if (require('./blastCoordinator').isBlastActive()) return;
  } catch {
    /* optional */
  }

  const socketRegistry = require('./socketRegistry');
  if (!socketRegistry.isOnline(sockRef)) {
    const wait = Math.max(socketRegistry.warmupRemainingMs() + 5000, 20000);
    exports.rescheduleWithDelay(jid, wait);
    return;
  }

  postChain = postChain
    .then(async () => {
      if (!sockRef || require('./gracefulShutdownManager').isShuttingDown()) return;

      try {
        await require('../ipc/promoQueue').processNextIfAny(sockRef);
      } catch {
        /* fila promo Hanork — não bloqueia GP */
      }

      const antiBan = require('./antiBan');
      if (!antiBan.canPostNow()) {
        const waitInfo = require('../utils/antiBanWaitLabel').getAntiBanWaitInfo();
        const waitMs = waitInfo.waitMs || humanDelay(120000, 240000);
        if (logThrottle.shouldLog(`event-antiban-${jid}`, 5 * 60 * 1000)) {
          infoLog(
            `Scheduler: anti-ban ~${waitInfo.label} — ${jid.split('@')[0]} reagendado`
          );
        }
        exports.rescheduleWithDelay(jid, waitMs);
        return;
      }

      const group = groupValidator.loadActiveGroups()[jid];
      if (!group) {
        exports.unschedule(jid);
        return;
      }

      groupScheduler.syncFromGroup(jid, group);
      const skip = groupScheduler.getSkipReason(jid, group);
      if (skip) {
        exports.reschedule(jid);
        return;
      }

      const check = await postGuard.canPostToGroupLive(sockRef, jid);
      if (!check.ok) {
        exports.rescheduleWithDelay(jid, humanDelay(120000, 240000));
        return;
      }

      const safe = require('../utils/safe');
      const postagem = require('./postagem');
      const monitor = require('./monitor');

      const sent = await safe.run(`Evento ${jid.split('@')[0]}`, () =>
        postagem.runPostCycle(sockRef, [jid], { source: 'event', skipQueue: true })
      );

      if (sent > 0) {
        monitor.inc('postsSent', sent);
        exports.reschedule(jid);
      } else {
        exports.rescheduleWithDelay(jid, humanDelay(60000, 120000));
      }
    })
    .catch(() => {
      exports.rescheduleWithDelay(jid, humanDelay(90000, 240000));
    });

  await postChain;
}

function scheduleOne(jid, extraMs = 0) {
  exports.unschedule(jid);
  const group = groupValidator.loadActiveGroups()[jid];
  if (!group) return;

  groupScheduler.syncFromGroup(jid, group);
  const st = groupScheduler.loadGroupState(jid);
  const delay = computeDelayMs(jid, st) + extraMs;

  timerRegistry.register(`event:${jid}`, Date.now() + delay, { jid, type: 'groupEvent' });

  const handle = setTimeout(() => {
    timers.delete(jid);
    fireGroupPost(jid).catch(() => {});
  }, delay);
  if (handle.unref) handle.unref();
  timers.set(jid, handle);
}

exports.start = (sock, opts = {}) => {
  if (started) return;
  started = true;
  sockRef = sock;
  staggerIndex = 0;
  postChain = Promise.resolve();

  const candidates = listCandidates();
  const { ok } = groupHealth.filterHealthy(candidates);
  for (const g of ok) scheduleOne(g.id);

  const safetyMs = cfg.SCHEDULER_SAFETY_POLL_MS ?? 30 * 60 * 1000;
  safetyTimer = setInterval(() => {
    if (!sockRef) return;
    for (const g of listCandidates()) {
      if (!timers.has(g.id)) scheduleOne(g.id);
    }
  }, safetyMs);
  if (safetyTimer.unref) safetyTimer.unref();

  if (!opts.silent && logThrottle.shouldLog('event-scheduler-start', 60000)) {
    bootQuiet.bootInfo(
      infoLog,
      `Scheduler event-driven: ${timers.size} timer(s) · safety ${Math.round(safetyMs / 60000)} min`
    );
  }

  if (cfg.POST_ON_START !== false) {
    exports.primeDueGroups();
  }
};

exports.stop = () => {
  started = false;
  sockRef = null;
  staggerIndex = 0;
  postChain = Promise.resolve();
  for (const [jid] of timers) exports.unschedule(jid);
  if (safetyTimer) clearInterval(safetyTimer);
  safetyTimer = null;
};

exports.unschedule = (jid) => {
  const t = timers.get(jid);
  if (t) clearTimeout(t);
  timers.delete(jid);
  try {
    timerRegistry.cancel(`event:${jid}`);
  } catch {
    /* ignore */
  }
};

exports.reschedule = (jid) => {
  if (!started || !sockRef) return;
  scheduleOne(jid);
};

exports.rescheduleWithDelay = (jid, delayMs) => {
  if (!started || !sockRef) return;
  scheduleOne(jid, Math.max(0, delayMs));
};

exports.rescheduleAll = () => {
  if (!started) return;
  staggerIndex = 0;
  for (const g of listCandidates()) scheduleOne(g.id);
};

/** Na subida: grupos sem post recente entram na fila com delay curto */
exports.primeDueGroups = () => {
  if (!started || !sockRef) return 0;
  const analysis = postGuard.analyzeDivulgacaoGroups({ forStartup: true });
  if (!analysis.due.length) return 0;

  staggerIndex = 0;
  let slot = 0;
  const dueIds = new Set(analysis.due.map((g) => g.id));
  const minD = cfg.STARTUP_PRIME_DELAY_MIN_MS ?? 4000;
  const maxD = cfg.STARTUP_PRIME_DELAY_MAX_MS ?? 12000;
  const stagger = cfg.STARTUP_PRIME_STAGGER_MS ?? 10000;

  for (const g of listCandidates()) {
    if (dueIds.has(g.id)) {
      const delay = humanDelay(minD, maxD) + slot * randomInt(Math.round(stagger * 0.7), stagger);
      slot++;
      exports.rescheduleWithDelay(g.id, delay);
    } else if (!timers.has(g.id)) {
      scheduleOne(g.id);
    }
  }

  if (logThrottle.shouldLog('event-prime-due', 120000)) {
    bootQuiet.bootInfo(
      infoLog,
      `Divulgação: ${analysis.due.length} grupo(s) na fila (primeiro em ~${Math.round(minD / 1000)}s)`
    );
  }
  return analysis.due.length;
};

/** Dispara status imediato nos grupos sem post recente (complementa o catchup em lote) */
exports.runImmediateDuePosts = async (maxGroups = 0) => {
  if (!started || !sockRef) return 0;
  const cap = maxGroups > 0 ? maxGroups : cfg.STARTUP_IMMEDIATE_MAX_GROUPS ?? 5;
  const analysis = postGuard.analyzeDivulgacaoGroups({ forStartup: true });
  const ids = analysis.due.slice(0, cap).map((g) => g.id);
  if (!ids.length) return 0;

  const postagem = require('./postagem');
  const safe = require('../utils/safe');
  const sent = await safe.run('Divulgação imediata (boot)', () =>
    postagem.runPostCycle(sockRef, ids, { startupFast: true, skipQueue: true })
  );
  return sent || 0;
};

exports.getNextEventMs = () => {
  let earliest = null;
  try {
    const data = timerRegistry.load();
    for (const t of Object.values(data.timers || {})) {
      if (t.meta?.type !== 'groupEvent' || !t.fireAt) continue;
      const ms = new Date(t.fireAt).getTime();
      if (earliest === null || ms < earliest) earliest = ms;
    }
  } catch {
    /* ignore */
  }
  return earliest;
};

exports.activeCount = () => timers.size;

exports.isEnabled = () =>
  cfg.DISTRIBUTED_SCHEDULER_ENABLED !== false && cfg.SCHEDULER_EVENT_DRIVEN !== false;

module.exports = exports;
