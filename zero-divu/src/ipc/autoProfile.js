'use strict';

const cfg = require('../config/divulgacao');
const store = require('../utils/debouncedStore');
const { infoLog, warningLog } = require('../utils/logger');
const logThrottle = require('../utils/logThrottle');

const FILE = 'autoProfileState.json';
const MIN_CHECK_MS = 2 * 60 * 1000;
const LOW_RISK_THRESHOLD = 28;
const UPGRADE_STREAK = 4;

const PROFILE_ORDER = { safe: 0, balanced: 1, aggressive: 2 };

function envBool(name, fallback = true) {
  const v = process.env[name];
  if (v == null || v === '') return fallback;
  return !['0', 'false', 'no', 'off'].includes(String(v).trim().toLowerCase());
}

function loadState() {
  return store.load(FILE, {
    lowRiskStreak: 0,
    lastChangeAt: null,
    lastCheckAt: 0,
    lastRiskScore: 0,
    lastReasons: [],
  });
}

function saveState(s) {
  store.set(FILE, s);
}

function isAutoEnabled() {
  if (!envBool('ZERO_DIVU_AUTO_PROFILE', true)) return false;
  try {
    return require('../ipc/configApplier').isAutoProfileEnabled();
  } catch {
    return true;
  }
}

function currentProfile() {
  return cfg.OPERATION_PROFILE || 'safe';
}

function evaluateRisk() {
  const reasons = [];
  let score = 0;

  const safeMode = require('./safeMode');
  if (safeMode.isPaused()) {
    return { score: 100, reasons: ['modo seguro pausado após falhas consecutivas'] };
  }

  const sm = store.load('safeMode.json', { fails: 0, pausedUntil: 0 });
  if (sm.fails > 0) {
    score += Math.min(36, sm.fails * 12);
    reasons.push(`${sm.fails} ciclo(s) sem envio recente`);
  }

  const antiBan = require('./antiBan');
  const limits = antiBan.getLimits();
  const postRatio = limits.maxPosts ? limits.posts / limits.maxPosts : 0;
  const joinRatio = limits.maxJoins ? limits.joins / limits.maxJoins : 0;

  if (postRatio >= 0.9) {
    score += 28;
    reasons.push(`cota de posts ${limits.posts}/${limits.maxPosts}/h`);
  } else if (postRatio >= 0.7) {
    score += 14;
    reasons.push('volume de posts elevado na hora');
  }

  if (joinRatio >= 0.9) {
    score += 22;
    reasons.push(`cota de entradas ${limits.joins}/${limits.maxJoins}/h`);
  } else if (joinRatio >= 0.7) {
    score += 11;
    reasons.push('muitas entradas em grupos na hora');
  }

  try {
    const patternGuard = require('./patternGuard');
    if (patternGuard.detectHourCluster()) {
      score += 18;
      reasons.push('posts concentrados no mesmo horário');
    }
    if (patternGuard.suggestDelayAdjustment() > 0) {
      score += 12;
      reasons.push('padrão repetitivo entre envios');
    }
  } catch {
    /* ignore */
  }

  try {
    const runtimeRecovery = require('./runtimeRecovery');
    if (runtimeRecovery.isRecoveryActive()) {
      score += 25;
      reasons.push('recovery mode após queda inesperada');
    }
  } catch {
    /* ignore */
  }

  const warmup = require('./warmup');
  if (warmup.isActive()) {
    score += 22;
    reasons.push('warm-up da conta (primeiras 48h)');
  }

  try {
    const groupValidator = require('./groupValidator');
    const active = groupValidator.loadActiveGroups();
    let errGroups = 0;
    for (const g of Object.values(active || {})) {
      if ((g.errors || 0) >= (cfg.GROUP_ERROR_PAUSE_THRESHOLD ?? 3)) errGroups++;
    }
    if (errGroups >= 3) {
      score += 16;
      reasons.push(`${errGroups} grupos com falhas repetidas`);
    } else if (errGroups >= 1) {
      score += 8;
      reasons.push('falhas em alguns grupos');
    }
  } catch {
    /* ignore */
  }

  try {
    const stats = require('./monitor').getStats();
    const ok = stats.joinsOk || 0;
    const fail = stats.joinsFail || 0;
    const total = ok + fail;
    if (total >= 5) {
      const rate = fail / total;
      if (rate >= 0.35) {
        score += 22;
        reasons.push('taxa alta de falha ao entrar em grupos');
      } else if (rate >= 0.18) {
        score += 11;
        reasons.push('algumas falhas ao entrar em grupos');
      }
    }
  } catch {
    /* ignore */
  }

  return { score: Math.min(100, score), reasons };
}

function profileForRisk(score, { warmupActive = false } = {}) {
  if (warmupActive) {
    if (score >= 45) return 'safe';
    return 'balanced';
  }
  if (score >= 58) return 'safe';
  if (score >= 28) return 'balanced';
  return 'aggressive';
}

function isSafer(a, b) {
  return (PROFILE_ORDER[a] ?? 0) < (PROFILE_ORDER[b] ?? 0);
}

function isRiskier(a, b) {
  return (PROFILE_ORDER[a] ?? 0) > (PROFILE_ORDER[b] ?? 0);
}

async function applyProfile(target, meta = {}) {
  const configApplier = require('../ipc/configApplier');
  const prev = currentProfile();
  if (target === prev) return { changed: false, profile: prev };

  configApplier.setProfile(target);
  await configApplier.persistPatch();

  const st = loadState();
  st.lastChangeAt = new Date().toISOString();
  st.lastRiskScore = meta.score ?? st.lastRiskScore;
  st.lastReasons = meta.reasons || st.lastReasons;
  saveState(st);

  try {
    const { writeStateSnapshot } = require('../ipc/stateWriter');
    await writeStateSnapshot({
      profile: target,
      autoProfile: isAutoEnabled(),
      spamRiskScore: meta.score,
      spamRiskReasons: meta.reasons,
    });
  } catch {
    /* ignore */
  }

  try {
    const eventBus = require('../ipc/eventBus');
    await eventBus.appendEvent({
      type: 'wa.profile_auto',
      from: prev,
      to: target,
      score: meta.score,
      reasons: meta.reasons,
    });
  } catch {
    /* ignore */
  }

  const arrow = isSafer(target, prev) ? '↓' : '↑';
  warningLog(
    `Perfil auto ${arrow} ${prev} → ${target} (risco ${meta.score ?? '?'}/100${meta.reasons?.length ? ': ' + meta.reasons[0] : ''})`
  );

  return { changed: true, profile: target, previous: prev };
}

exports.isEnabled = isAutoEnabled;

exports.evaluateRisk = evaluateRisk;

exports.getStatus = () => {
  const risk = evaluateRisk();
  const st = loadState();
  return {
    enabled: isAutoEnabled(),
    profile: currentProfile(),
    riskScore: risk.score,
    reasons: risk.reasons,
    lowRiskStreak: st.lowRiskStreak,
    upgradeStreakNeed: UPGRADE_STREAK,
    lastChangeAt: st.lastChangeAt,
  };
};

exports.maybeAdjust = async (opts = {}) => {
  if (!isAutoEnabled()) return { skipped: true, reason: 'disabled' };

  const st = loadState();
  const now = Date.now();
  if (!opts.force && now - (st.lastCheckAt || 0) < MIN_CHECK_MS) {
    return { skipped: true, reason: 'cooldown' };
  }

  st.lastCheckAt = now;
  const risk = evaluateRisk();
  st.lastRiskScore = risk.score;
  st.lastReasons = risk.reasons;

  const warmup = require('./warmup');
  const target = profileForRisk(risk.score, { warmupActive: warmup.isActive() });
  const cur = currentProfile();

  if (risk.score <= LOW_RISK_THRESHOLD && !warmup.isActive()) {
    st.lowRiskStreak = (st.lowRiskStreak || 0) + 1;
  } else {
    st.lowRiskStreak = 0;
  }

  saveState(st);

  if (target === cur) {
    return { changed: false, profile: cur, riskScore: risk.score, reasons: risk.reasons };
  }

  if (isSafer(target, cur)) {
    const out = await applyProfile(target, { score: risk.score, reasons: risk.reasons });
    return { ...out, riskScore: risk.score, reasons: risk.reasons };
  }

  if (isRiskier(target, cur)) {
    if (warmup.isActive()) {
      return { changed: false, profile: cur, riskScore: risk.score, reasons: risk.reasons };
    }
    if (st.lowRiskStreak < UPGRADE_STREAK) {
      if (logThrottle.shouldLog('auto-profile-hold', 15 * 60 * 1000)) {
        infoLog(
          `Perfil auto: risco baixo (${risk.score}) — aguardando estabilidade (${st.lowRiskStreak}/${UPGRADE_STREAK}) antes de ${target}`
        );
      }
      return { changed: false, profile: cur, riskScore: risk.score, reasons: risk.reasons };
    }
    const out = await applyProfile(target, { score: risk.score, reasons: risk.reasons });
    st.lowRiskStreak = 0;
    saveState(st);
    return { ...out, riskScore: risk.score, reasons: risk.reasons };
  }

  return { changed: false, profile: cur, riskScore: risk.score, reasons: risk.reasons };
};

exports.maybeAdjustAfterCycle = async ({ sent = 0, total = 0 } = {}) => {
  if (!isAutoEnabled()) return null;
  if (sent === 0 && total > 0) {
    return exports.maybeAdjust({ force: true });
  }
  return exports.maybeAdjust();
};

module.exports = exports;
