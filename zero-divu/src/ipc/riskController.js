'use strict';

const store = require('../utils/debouncedStore');
const logThrottle = require('../utils/logThrottle');
const { warningLog, infoLog } = require('../utils/logger');

const FILE = 'riskState.json';

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function normalize(s) {
  const now = Date.now();
  const out = {
    riskScore: clamp(Number(s.riskScore) || 0, 0, 100),
    pausedUntil: Number(s.pausedUntil) || 0,
    softPausedUntil: Number(s.softPausedUntil) || 0,
    circuitBrokenUntil: Number(s.circuitBrokenUntil) || 0,
    lastCircuitAt: Number(s.lastCircuitAt) || 0,
    lastCircuitReason: s.lastCircuitReason || null,
    connectStormUntil: Number(s.connectStormUntil) || 0,
    lastSignalAt: Number(s.lastSignalAt) || 0,
    lastSignal: s.lastSignal || null,
    burstWindowAt: Number(s.burstWindowAt) || now,
    burstSignals: Number(s.burstSignals) || 0,
    lastConnectAt: Number(s.lastConnectAt) || 0,
  };

  const WIN = 10 * 60 * 1000;
  if (out.burstWindowAt > now || now - out.burstWindowAt > WIN) {
    out.burstWindowAt = now;
    out.burstSignals = 0;
  }
  return out;
}

function load() {
  return normalize(store.load(FILE, {}));
}

function save(s) {
  store.setCritical(FILE, normalize(s));
}

function bump(s, delta, { signal = null } = {}) {
  s.riskScore = clamp((s.riskScore || 0) + delta, 0, 100);
  s.lastSignalAt = Date.now();
  if (signal) s.lastSignal = signal;
  s.burstSignals = (s.burstSignals || 0) + 1;
  return s;
}

function schedulePause(s, ms, { soft = false, reason = '' } = {}) {
  const until = Date.now() + Math.max(0, ms);
  if (soft) s.softPausedUntil = Math.max(s.softPausedUntil || 0, until);
  else s.pausedUntil = Math.max(s.pausedUntil || 0, until);

  if (logThrottle.shouldLog(soft ? 'risk-soft-pause' : 'risk-hard-pause', 60 * 1000)) {
    warningLog(
      `${soft ? 'Anti-ban: pausa leve' : 'Anti-ban: PAUSA'} por ${Math.round(ms / 60000)} min${reason ? ` — ${reason}` : ''}`
    );
  }
  return s;
}

function scheduleCircuitBreak(s, ms, { reason = '' } = {}) {
  const until = Date.now() + Math.max(0, ms);
  s.circuitBrokenUntil = Math.max(s.circuitBrokenUntil || 0, until);
  s.lastCircuitAt = Date.now();
  s.lastCircuitReason = reason || null;
  s.pausedUntil = Math.max(s.pausedUntil || 0, s.circuitBrokenUntil);

  if (logThrottle.shouldLog('risk-circuit-break', 60 * 1000)) {
    warningLog(
      `Anti-ban: CIRCUIT BREAKER TOTAL por ${Math.round(ms / 3600000)}h${reason ? ` — ${reason}` : ''}`
    );
  }
  return s;
}

function classifyMessage(msg) {
  const s = String(msg || '');
  const sl = s.toLowerCase();
  if (/connect_storm|rate.?limit.*connect|disconnect:428/i.test(sl)) return 'wa_connect_storm';
  if (/rate-overlimit|overlimit|too many|429|\b428\b/i.test(s)) return 'wa_rate_limit';
  if (/spam|spammed|denied|blocked/i.test(sl) && /message|status|send|envio/i.test(sl)) return 'wa_spam_block';
  if (/temporarily|temporariamente|try again|aguarde|wait/i.test(sl) && /limit|bloque|ban/i.test(sl)) {
    return 'wa_temp_block';
  }
  if (/connection closed|connection was lost|stream errored|408|offline/i.test(sl)) return 'wa_unstable';
  if (/\b403\b/.test(sl)) return 'wa_forbidden';
  if (/not-authorized|not authorized|unauthorized|\b401\b/i.test(sl)) return 'wa_auth_denied';
  if (/forbidden|access denied/i.test(sl)) return 'wa_forbidden';
  return null;
}

exports.getState = () => load();

exports.isHardPaused = () => {
  const s = load();
  return Date.now() < Math.max(s.pausedUntil || 0, s.circuitBrokenUntil || 0);
};

exports.isSoftPaused = () => {
  const s = load();
  return Date.now() < (s.softPausedUntil || 0);
};

exports.isCircuitBroken = () => {
  const s = load();
  return Date.now() < (s.circuitBrokenUntil || 0);
};

exports.isConnectStormPaused = () => {
  const s = load();
  return Date.now() < (s.connectStormUntil || 0);
};

exports.canPostNow = () => !exports.isHardPaused() && !exports.isConnectStormPaused();
exports.canJoinNow = () => !exports.isHardPaused() && !exports.isConnectStormPaused();

const SERIOUS_SIGNALS = new Set([
  'wa_spam_block',
  'wa_forbidden',
  'wa_temp_block',
  'wa_auth_denied',
  'wa_connect_storm',
]);

exports.clearHardPause = (reason = 'admin_reset') => {
  const s = load();
  s.pausedUntil = 0;
  s.softPausedUntil = 0;
  s.circuitBrokenUntil = 0;
  s.riskScore = clamp(Math.min(s.riskScore || 0, 35), 0, 100);
  s.burstSignals = 0;
  s.lastSignal = reason;
  save(s);
  infoLog(`Anti-ban: pausa liberada manualmente (${reason}) · risco ${s.riskScore}/100`);
  return exports.getPauseInfo();
};

exports.getPauseInfo = () => {
  const s = load();
  const now = Date.now();
  const hardUntil = Math.max(s.pausedUntil || 0, s.circuitBrokenUntil || 0);
  const hardPaused = now < hardUntil;
  return {
    hardPaused,
    softPaused: now < (s.softPausedUntil || 0),
    connectStorm: now < (s.connectStormUntil || 0),
    untilMs: hardPaused ? hardUntil : 0,
    remainingMin: hardPaused ? Math.ceil((hardUntil - now) / 60000) : 0,
    riskScore: s.riskScore,
    lastSignal: s.lastSignal,
    circuit: Boolean(s.circuitBrokenUntil && now < s.circuitBrokenUntil),
  };
};

/** Reconexão estável: não manter pausa longa só por instabilidade/sync anterior (sem spam). */
exports.onWhatsAppConnected = () => {
  const s = load();
  const now = Date.now();
  s.lastConnectAt = now;
  s.burstSignals = 0;
  s.burstWindowAt = now;
  const hardEnd = Math.max(s.pausedUntil || 0, s.circuitBrokenUntil || 0);
  if (hardEnd <= now) {
    if ((s.riskScore || 0) > 55) {
      s.riskScore = clamp((s.riskScore || 0) - 25, 0, 55);
      s.burstSignals = 0;
      save(s);
    }
    return false;
  }
  if (SERIOUS_SIGNALS.has(s.lastSignal) || (s.circuitBrokenUntil && now < s.circuitBrokenUntil)) {
    return false;
  }
  const remainingMin = Math.ceil((hardEnd - now) / 60000);
  if (remainingMin <= 25) return false;

  s.pausedUntil = now + 20 * 60 * 1000;
  s.riskScore = clamp(Math.min(s.riskScore || 0, 50), 0, 100);
  s.burstSignals = 0;
  save(s);
  if (logThrottle.shouldLog('risk-connect-recover', 120 * 1000)) {
    infoLog(
      `Anti-ban: pausa atenuada após reconexão (${remainingMin} min → 20 min) — instabilidade anterior, sem spam`
    );
  }
  return true;
};

function _writeHanorkMirror(s) {
  const dir = process.env.ZERO_DIVU_IPC_DIR;
  if (!dir) return;
  try {
    const fs = require('fs');
    const path = require('path');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'wa-throttle.json'),
      JSON.stringify({
        riskScore: s.riskScore || 0,
        lastSignal: s.lastSignal || null,
        updatedAt: Date.now(),
      })
    );
  } catch {
    /* ignore */
  }
}

function getCircuitRampFactor(s) {
  const end = Number(s.circuitBrokenUntil) || 0;
  if (!end) return 1;
  const now = Date.now();
  if (now < end) return 0.25;
  const rampMs = 60 * 60 * 1000;
  const sinceEnd = now - end;
  if (sinceEnd <= 0) return 0.25;
  if (sinceEnd >= rampMs) return 1;
  const t = sinceEnd / rampMs;
  return 0.25 + 0.75 * t;
}

function mergeHanorkThrottleRisk(s) {
  const dir = process.env.ZERO_DIVU_IPC_DIR;
  if (!dir) return s.riskScore || 0;
  try {
    const fs = require('fs');
    const path = require('path');
    const p = path.join(dir, 'hanork-throttle.json');
    if (!fs.existsSync(p)) return s.riskScore || 0;
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (Date.now() - (Number(j.updatedAt) || 0) > 45 * 60 * 1000) return s.riskScore || 0;
    const hr = Number(j.riskScore) || 0;
    return clamp(Math.max(s.riskScore || 0, Math.round(hr * 0.75)), 0, 100);
  } catch {
    return s.riskScore || 0;
  }
}

exports.getThrottleFactor = () => {
  const s = load();
  const r = mergeHanorkThrottleRisk(s);
  const ramp = getCircuitRampFactor(s);
  const byRisk = r <= 15 ? 1 : r <= 40 ? 0.9 : r <= 60 ? 0.7 : r <= 80 ? 0.5 : 0.25;
  return clamp(Math.min(byRisk, ramp), 0.25, 1);
};

exports.recordConnectStorm = (count = 1, ms = 30 * 60 * 1000) => {
  const s = load();
  s.connectStormUntil = Math.max(s.connectStormUntil || 0, Date.now() + ms);
  bump(s, 12, { signal: 'wa_connect_storm' });
  schedulePause(s, ms, { reason: `rate_limit_connect x${count}` });
  save(s);
};

exports.recordSuccess = (kind = 'post') => {
  const s = load();
  const delta = kind === 'join' ? -2 : -3;
  bump(s, delta, { signal: `${kind}_ok` });
  save(s);
};

exports.recordSignal = (kind, msg = '') => {
  const auto = kind || classifyMessage(msg) || 'unknown';
  const s = load();

  const weights = {
    wa_connect_storm: 16,
    wa_rate_limit: 10,
    wa_unstable: 6,
    wa_auth_denied: 10,
    wa_forbidden: 18,
    wa_temp_block: 22,
    wa_spam_block: 35,
    post_fail: 6,
    join_fail: 5,
    unknown: 4,
  };
  const w = weights[auto] ?? 5;
  const recentConnect = Date.now() - (s.lastConnectAt || 0) < 3 * 60 * 1000;
  const softTransient =
    recentConnect &&
    (auto === 'wa_unstable' || auto === 'post_fail') &&
    !SERIOUS_SIGNALS.has(auto);
  bump(s, softTransient ? Math.max(1, Math.round(w / 2)) : w, { signal: auto });

  const burst = s.burstSignals || 0;
  if (auto === 'wa_spam_block' || auto === 'wa_forbidden') {
    scheduleCircuitBreak(s, 12 * 60 * 60 * 1000, { reason: auto });
  } else if (auto === 'wa_connect_storm') {
    scheduleCircuitBreak(s, 2 * 60 * 60 * 1000, { reason: auto });
  } else if (auto === 'wa_temp_block') {
    schedulePause(s, 6 * 60 * 60 * 1000, { reason: auto });
  } else if (burst >= 10 || s.riskScore >= 85) {
    const serious = SERIOUS_SIGNALS.has(auto) || SERIOUS_SIGNALS.has(s.lastSignal);
    const bootGrace =
      (Date.now() - (s.lastConnectAt || 0) < 8 * 60 * 1000) &&
      !SERIOUS_SIGNALS.has(auto);
    if (bootGrace) {
      schedulePause(s, 20 * 60 * 1000, { soft: true, reason: 'instabilidade no boot' });
    } else if (serious || burst >= 15 || s.riskScore >= 95) {
      schedulePause(s, 2 * 60 * 60 * 1000, { reason: 'muitos sinais' });
    } else {
      schedulePause(s, 30 * 60 * 1000, { soft: true, reason: 'instabilidade (sync/boot)' });
    }
  } else if (burst >= 6 || s.riskScore >= 70) {
    schedulePause(s, 45 * 60 * 1000, { soft: true, reason: 'risco alto' });
  } else if (auto === 'wa_rate_limit' || auto === 'wa_unstable') {
    schedulePause(s, 15 * 60 * 1000, { soft: true, reason: auto });
  }

  _writeHanorkMirror(s);
  save(s);

  if (logThrottle.shouldLog(`risk-signal-${auto}`, 60 * 1000)) {
    const ns = load();
    const tf = exports.getThrottleFactor();
    infoLog(
      `Anti-ban: sinal=${auto} · risco=${ns.riskScore}/100 · throttle=${tf.toFixed(2)}${ns.circuitBrokenUntil ? ' · circuit' : ''}`
    );
  }
};
