'use strict';

const colors = require('colors');
const cfg = require('../config/divulgacao');
const { formatUptime } = require('./formatter');
const { section, infoLog } = require('./logger');

const state = {
  bootAt: null,
  nextPeriodicAt: null,
  nextStartupAt: null,
  lastCycleAt: null,
  lastCycleDurationMs: 0,
  lastCycleSent: 0,
  lastCycleTotal: 0,
  lastCycleLabel: null,
  sessionPosts: 0,
  running: false,
  runningSince: null,
  runningLabel: null,
};

let renderTimer = null;
let compactTimer = null;

function formatCountdown(ms) {
  if (ms == null) return '—';
  if (ms <= 0) return 'agora';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function formatClock(isoOrMs) {
  return new Date(isoOrMs).toLocaleTimeString('pt-BR', { hour12: false });
}

function agoLabel(ms) {
  if (!ms) return 'nunca';
  return `há ${formatCountdown(Date.now() - ms)}`;
}

function nextEventMs() {
  const now = Date.now();
  const candidates = [state.nextPeriodicAt, state.nextStartupAt].filter((t) => t && t > now);
  if (!candidates.length) return null;
  return Math.min(...candidates);
}

function nextEventLabel() {
  const now = Date.now();
  const peri = state.nextPeriodicAt && state.nextPeriodicAt > now;
  const start = state.nextStartupAt && state.nextStartupAt > now;
  if (start && (!peri || state.nextStartupAt <= state.nextPeriodicAt)) {
    return 'sincronização inicial';
  }
  if (peri) return 'ciclo periódico';
  return 'ciclo';
}

exports.onBoot = () => {
  state.bootAt = Date.now();
  state.sessionPosts = 0;
};

exports.scheduleStartup = (atMs) => {
  state.nextStartupAt = atMs;
};

exports.schedulePeriodic = (atMs) => {
  state.nextPeriodicAt = atMs;
};

exports.clearStartup = () => {
  state.nextStartupAt = null;
};

exports.onCycleStart = (label) => {
  state.running = true;
  state.runningSince = Date.now();
  state.runningLabel = label || 'ciclo';
};

exports.onCycleEnd = (label, sent = 0, total = 0, startedAt) => {
  const ended = Date.now();
  state.running = false;
  state.runningSince = null;
  state.runningLabel = null;
  state.lastCycleAt = ended;
  state.lastCycleLabel = label || 'ciclo';
  state.lastCycleSent = sent;
  state.lastCycleTotal = total;
  state.lastCycleDurationMs = startedAt ? ended - startedAt : 0;
  if (sent > 0) state.sessionPosts += sent;
};

exports.getState = () => ({ ...state });

exports.buildRows = () => {
  const now = Date.now();
  const antiBan = require('../services/antiBan');
  const operationalLimits = require('../services/operationalLimits');
  const postGuard = require('../services/postGuard');
  const safeMode = require('../services/safeMode');
  const cycleLock = require('./cycleLock');
  const pendingInvites = require('../services/pendingInvites');
  const monitor = require('../services/monitor');

  const limits = antiBan.getLimits();
  const hourLeft = antiBan.getMsUntilHourReset?.() ?? null;
  const analysis = postGuard.analyzeDivulgacaoGroups();
  const snap = operationalLimits.snapshot();
  const w = snap.warmup;
  const nextAt = nextEventMs();
  let cycleMode = `a cada ${Math.round((cfg.POST_INTERVAL || 3600000) / 60000)} min`;
  try {
    const distributed = require('../services/distributedScheduler');
    if (distributed.isEnabled()) {
      cycleMode = `distribuído · ${distributed.maxGroupsPerWake()} GP/wake · nextPostAt`;
    }
  } catch {
    /* ignore */
  }
  const intervalMin = Math.round((cfg.POST_INTERVAL || 3600000) / 60000);
  const hist = monitor.getStats().postsSent;
  const types = monitor.countGroupTypes?.() || {};

  const rows = [
    ['Tempo online', state.bootAt ? formatUptime(now - state.bootAt) : '—'],
    [
      'Modo de envio',
      (() => {
        try {
          return require('../services/statusMessage').mirrorToChatEnabled()
            ? 'Status + chat (espelho após OK)'
            : 'somente Status do grupo';
        } catch {
          return 'somente Status do grupo';
        }
      })(),
    ],
  ];

  if (state.running) {
    rows.push([
      'Divulgando agora',
      `${state.runningLabel} · ${formatCountdown(now - (state.runningSince || now))}`,
    ]);
  } else if (state.lastCycleAt) {
    rows.push([
      'Última divulgação',
      `${agoLabel(state.lastCycleAt)} · ${state.lastCycleLabel} · ${state.lastCycleSent}/${state.lastCycleTotal || '?'} status`,
    ]);
    if (state.lastCycleDurationMs > 0) {
      rows.push(['Duração do último ciclo', formatCountdown(state.lastCycleDurationMs)]);
    }
  } else {
    rows.push(['Última divulgação', 'ainda não rodou']);
  }

  if (nextAt) {
    rows.push([
      'Próximo envio',
      `em ${formatCountdown(nextAt - now)} (${formatClock(nextAt)}) · ${nextEventLabel()}`,
    ]);
  } else if (cycleMode.includes('distribuído')) {
    let nextLine = cycleMode;
    try {
      const ne = require('../services/groupEventScheduler').getNextEventMs?.();
      if (ne && ne > now) {
        nextLine = `em ${formatCountdown(ne - now)} (${formatClock(ne)}) · timer por grupo`;
      }
    } catch {
      /* ignore */
    }
    rows.push(['Próximo envio', nextLine]);
  } else {
    rows.push(['Próximo envio', cycleMode]);
  }

  if (!cycleMode.includes('distribuído')) {
    rows.push(['Modo de ciclo', cycleMode]);
    rows.push(['Intervalo entre ciclos', `${intervalMin} min`]);
  } else {
    rows.push(['Modo de ciclo', 'event-driven · 1 GP por vez']);
  }
  rows.push([
    'Status',
    `sessão ${state.sessionPosts} · histórico ${hist} · cota ${limits.posts}/${limits.maxPosts}/h`,
  ]);
  if (hourLeft != null) {
    rows.push(['Renovação da cota', `em ${formatCountdown(hourLeft)}`]);
  }
  rows.push([
    'Grupos no ciclo',
    `${types.cycle ?? '—'} ativos · ${analysis.due.length} prontos · ${analysis.recent.length} em intervalo · ${analysis.grace.length} carência`,
  ]);
  rows.push(['Aguardando admin', String(types.pending ?? 0)]);
  rows.push(['Convites na fila', String(pendingInvites.count())]);

  try {
    const q = require('../services/queueManager').counts();
    rows.push([
      'Filas persistentes',
      `join ${q.join} · delivery ${q.delivery} · retry ${q.retry} · maint ${q.maintenance}`,
    ]);
  } catch {
    /* ignore */
  }

  rows.push([
    'Entradas/hora',
    `${limits.joins}/${limits.maxJoins}${limits.warmup ? ' (warm-up)' : ''}`,
  ]);

  if (w.active) {
    rows.push(['Warm-up', `${w.percent}% · ~${w.remainingHours}h restantes`]);
  }
  if (safeMode.isPaused()) {
    rows.push(['Modo seguro', colors.yellow('ATIVO — divulgação pausada')]);
  }
  if (cycleLock.isBusy()) {
    rows.push(['Em execução', `ciclo "${cycleLock.getOwner()}"`]);
  }

  return rows;
};

exports.renderCompact = () => {
  if (cfg.CONSOLE_CRONOMETRO_ENABLED === false || !state.bootAt) return;

  const terminalAdapter = require('./terminalAdapter');
  terminalAdapter.refresh();
  const now = Date.now();
  const antiBan = require('../services/antiBan');
  const postGuard = require('../services/postGuard');
  const limits = antiBan.getLimits();
  const analysis = postGuard.analyzeDivulgacaoGroups();
  const nextAt = nextEventMs();

  let cycleMode = `ciclo ${Math.round((cfg.POST_INTERVAL || 3600000) / 60000)} min`;
  try {
    const distributed = require('../services/distributedScheduler');
    if (distributed.isEnabled()) {
      cycleMode = `distribuído · ${distributed.maxGroupsPerWake()} GP/wake`;
    }
  } catch {
    /* ignore */
  }

  let status = 'ocioso';
  if (state.running) {
    status = `enviando ${state.runningLabel} (${formatCountdown(now - state.runningSince)})`;
  } else if (state.lastCycleAt) {
    status = `último ${agoLabel(state.lastCycleAt)}`;
  }

  const prox = nextAt
    ? `próximo em ${formatCountdown(nextAt - now)}`
    : cycleMode;

  infoLog(
    terminalAdapter.truncate(
      `⏱ ${formatUptime(now - state.bootAt)} · ${status} · ${prox} · posts ${limits.posts}/${limits.maxPosts} · ${analysis.due.length} pronto(s)`,
      terminalAdapter.get().width
    )
  );
};

exports.render = () => {
  if (cfg.CONSOLE_CRONOMETRO_ENABLED === false) return;

  const terminalAdapter = require('./terminalAdapter');
  terminalAdapter.refresh();

  section('Painel · cronômetro');
  for (const [k, v] of exports.buildRows()) {
    const row = terminalAdapter.formatRow(k, String(v).replace(/\x1b\[[0-9;]*m/g, ''));
    const val = typeof v === 'string' && v.includes('\x1b') ? v : colors.cyan(String(v));
    if (row.compact) {
      console.log(colors.gray('  •'), colors.white(`${row.key}:`), val);
    } else {
      console.log(colors.gray('  •'), colors.white(`${k}:`), val);
    }
  }
  console.log('');
};

exports.startTicker = () => {
  if (cfg.CONSOLE_CRONOMETRO_ENABLED === false) return;

  const fullMs = cfg.CONSOLE_CRONOMETRO_INTERVAL_MS || 120000;
  const compactMs = cfg.CONSOLE_CRONOMETRO_COMPACT_MS || 60000;

  if (renderTimer) clearInterval(renderTimer);
  if (compactTimer) clearInterval(compactTimer);

  renderTimer = setInterval(() => exports.render(), fullMs);
  compactTimer = setInterval(() => exports.renderCompact(), compactMs);
};

exports.stopTicker = () => {
  if (renderTimer) clearInterval(renderTimer);
  if (compactTimer) clearInterval(compactTimer);
  renderTimer = null;
  compactTimer = null;
};

module.exports = exports;
