'use strict';

const cfg = require('../config/divulgacao');
const postagem = require('./postagem');
const postGuard = require('./postGuard');
const antiBan = require('./antiBan');
const safeMode = require('./safeMode');
const activeHours = require('../utils/activeHours');
const operationalLimits = require('./operationalLimits');
const labels = require('../utils/groupLabels');
const { sleep } = require('../utils/sleep');
const schedulerClock = require('../utils/schedulerClock');
const { infoLog, successLog, warningLog, section } = require('../utils/logger');
const logThrottle = require('../utils/logThrottle');

function batchSize() {
  const startupN = cfg.STARTUP_CATCHUP_BATCH_SIZE ?? 0;
  if (startupN > 0) return startupN;
  try {
    if (require('./groupEventScheduler').isEnabled()) {
      return cfg.STARTUP_CATCHUP_EVENT_BATCH_SIZE ?? 3;
    }
  } catch {
    /* ignore */
  }
  const cap = operationalLimits.getMaxGroupsPerCycle();
  return cap > 0 ? cap : 12;
}

function maxPostsThisRun() {
  return Math.min(
    cfg.STARTUP_CATCHUP_MAX_POSTS ?? 35,
    operationalLimits.getMaxPostsPerHour()
  );
}

function summarizeBlocked(blocked) {
  const byReason = {};
  for (const b of blocked) {
    const key = (b.reason || 'outro').split('—')[0].trim().slice(0, 40);
    byReason[key] = (byReason[key] || 0) + 1;
  }
  return Object.entries(byReason)
    .map(([k, n]) => `${k} (${n})`)
    .join(' · ');
}

function logAnalysis(analysis) {
  const throttleMs = cfg.STARTUP_ANALYSIS_LOG_THROTTLE_MS ?? 30 * 60 * 1000;
  if (!logThrottle.shouldLog('startup-catchup-analysis', throttleMs)) return;

  const intervalH = Math.round((cfg.MIN_GROUP_POST_INTERVAL_MS || 43200000) / 3600000);
  section('Verificação ao iniciar');
  infoLog(
    `Mín. ${intervalH}h entre posts no mesmo grupo · ${analysis.due.length} para postar agora · ${analysis.recent.length} com post recente · ${analysis.grace.length} em carência · ${analysis.blocked.length} bloqueado(s)`
  );

  if (analysis.due.length) {
    const sample = analysis.due.slice(0, 6).map((g) => {
      const name = labels.displayName(g, labels.shortId(g.id));
      return g.lastPostAt ? `${name} (último há ${g.hoursSincePost}h)` : `${name} (nunca postou)`;
    });
    infoLog(`Vai divulgar agora: ${sample.join('; ')}${analysis.due.length > 6 ? '…' : ''}`);
  }

  if (analysis.recent.length) {
    const sample = analysis.recent.slice(0, 4).map((r) => {
      const name = labels.displayName(r.group, labels.shortId(r.id));
      return `${name} (~${r.minutesLeft} min)`;
    });
    infoLog(`Post recente (aguardar): ${sample.join('; ')}${analysis.recent.length > 4 ? '…' : ''}`);
  }

  if (analysis.grace.length) {
    const sample = analysis.grace.slice(0, 4).map((r) => {
      const name = labels.displayName(r.group, labels.shortId(r.id));
      return `${name} (~${r.minutesLeft} min)`;
    });
    infoLog(`Carência pós-entrada: ${sample.join('; ')}${analysis.grace.length > 4 ? '…' : ''}`);
  }

  if (analysis.blocked.length) {
    const sample = analysis.blocked.slice(0, 4).map((b) => {
      const name = labels.displayName(b.group, labels.shortId(b.id));
      return `${name}: ${b.reason}`;
    });
    infoLog(`Bloqueados: ${summarizeBlocked(analysis.blocked)}`);
    if (sample.length) infoLog(`  ${sample.join(' | ')}`);
  }

  if (!analysis.due.length && !analysis.recent.length && !analysis.grace.length && !analysis.blocked.length) {
    infoLog('Nenhum grupo de divulgação ativo para sincronizar');
  }
}

exports.run = async (sock) => {
  const cycleStarted = Date.now();
  const label = 'sincronização inicial';
  schedulerClock.onCycleStart(label);

  const finish = (sent, total) => {
    schedulerClock.onCycleEnd(label, sent, total, cycleStarted);
    if (sent > 0) schedulerClock.render();
    return sent;
  };

  if (cfg.STARTUP_CATCHUP_ENABLED === false) return finish(0, 0);

  if (safeMode.isPaused()) {
    warningLog('Modo seguro ativo — sincronização inicial adiada');
    return finish(0, 0);
  }

  if (!activeHours.isActiveNow()) {
    infoLog('Fora do horário — sincronização inicial adiada');
    return finish(0, 0);
  }

  const analysis = postGuard.analyzeDivulgacaoGroups({ forStartup: true });
  logAnalysis(analysis);

  if (!analysis.due.length) {
    if (analysis.grace.length) {
      infoLog('Grupos novos em carência — ciclo periódico postará quando liberar');
    } else if (analysis.recent.length) {
      infoLog('Todos com post recente — próximo ciclo no agendamento normal');
    } else if (analysis.blocked.length) {
      warningLog('Nenhum grupo liberado para sincronização inicial — revise classificação ou aprovações');
    }
    return finish(0, 0);
  }

  const pauseMs = cfg.STARTUP_CATCHUP_BATCH_PAUSE_MS ?? cfg.BATCH_PAUSE_MS ?? 60000;
  const totalTarget = analysis.due.length;
  const maxPosts = maxPostsThisRun();
  const size = batchSize();
  const interBatchMs = pauseMs;

  let queue = analysis.due
    .map((g) => g.id)
    .filter((id) => postGuard.canPostToGroup(id).ok);
  let totalSent = 0;
  let batchNum = 0;

  while (queue.length > 0 && totalSent < maxPosts) {
    if (!antiBan.canPostNow()) {
      const lim = antiBan.getLimits();
      warningLog(
        `Cota horária (${lim.posts}/${lim.maxPosts}) — ${queue.length} grupo(s) no próximo ciclo`
      );
      break;
    }

    const chunk = queue.splice(0, size);
    batchNum++;
    infoLog(`Lote ${batchNum}: ${chunk.length} grupo(s)`);

    const sent = await postagem.runPostCycle(sock, chunk, { startupFast: true });
    totalSent += sent;

    queue = queue.filter((id) => postGuard.canPostToGroup(id).ok);

    if (queue.length > 0 && sent > 0) {
      const wait = interBatchMs;
      const waitLabel =
        wait >= 60000
          ? `${Math.round(wait / 60000)} min`
          : `${Math.round(wait / 1000)}s`;
      infoLog(`Pausa catchup ${waitLabel} antes do próximo lote…`);
      await sleep(wait);
    } else if (queue.length > 0 && sent === 0) {
      warningLog('Lote sem envios — parando sincronização inicial');
      break;
    }
  }

  if (queue.length > 0) {
    infoLog(`${queue.length} grupo(s) restante(s) — ciclo periódico continua (sem flood)`);
  }

  if (totalSent > 0) {
    safeMode.recordSuccess();
    successLog(`Sincronização inicial: ${totalSent} status em ${batchNum} lote(s)`);
  }

  return finish(totalSent, totalTarget);
};

module.exports = exports;
