'use strict';

const fs = require('fs-extra');
const { notifyBroadcastComplete } = require('../../telegram/broadcastNotify');
const { getZeroDivuClient } = require('./ZeroDivuClient');
const { toTwoCols } = require('../../telegram/menus/twoColKeyboard');

/** @type {import('telegraf').Telegraf | null} */
let botRef = null;
let loggerRef = null;
/** @type {((rows: unknown[][]) => object) | null} */
let keyboardBuilder = null;

const pending = new Map();
const jobWatches = new Map();
const TTL_MS = 45 * 60 * 1000;

function init({ bot, logger, Markup }) {
  botRef = bot;
  loggerRef = logger;
  keyboardBuilder = (rows) => Markup.inlineKeyboard(toTwoCols(rows));
}

function prune() {
  const now = Date.now();
  for (const [id, entry] of pending.entries()) {
    if (now - (entry.startedAt || 0) > TTL_MS) {
      pending.delete(id);
      stopJobWatch(id);
    }
  }
}

function parseBlastId(jobId) {
  if (!jobId) return null;
  const m = String(jobId).match(/^([a-f0-9]+)-(wa_[ab])$/i);
  return m ? m[1] : null;
}

function buildRunningKeyboard() {
  if (!keyboardBuilder) return null;
  return keyboardBuilder([[{ text: '🔙 Painel WA', callback_data: 'a_wa_menu' }]]);
}

function buildCompleteKeyboard() {
  if (!keyboardBuilder) return null;
  return keyboardBuilder([
    [{ text: '📢 Novo blast', callback_data: 'a_wa_custom_blast' }],
    [
      { text: '🛠 Status ops', callback_data: 'a_ops_status' },
      { text: '💰 Saldo', callback_data: 'a_ops_balance' },
    ],
    [
      { text: '🔙 Painel WA', callback_data: 'a_wa_menu' },
      { text: '🏠 Menu', callback_data: 'menu:home' },
    ],
  ]);
}

function sessionLine(exp, data) {
  if (data?.failedStart) {
    return `❌ ${exp.label}: ${data.error || 'falhou ao iniciar'}`;
  }
  if (!data?.complete) return `⏳ ${exp.label}: enviando status…`;
  const ok = data.sent ?? 0;
  const tot = data.total ?? 0;
  const fail = (data.failed ?? 0) + (data.skipped ?? 0);
  if (tot === 0 && ok === 0) {
    const why = data.message || data.error;
    if (why) return `❌ ${exp.label}: ${why}`;
    return `❌ ${exp.label}: 0 grupos — sincronize no painel WA ou aguarde anti-ban`;
  }
  const extra = fail > 0 ? ` · ${fail} falha/pulado` : '';
  return `✅ ${exp.label}: ${ok}/${tot} OK${extra}`;
}

function aggregate(entry) {
  let sent = 0;
  let groups = 0;
  let fail = 0;
  let hasFailedStart = false;
  for (const exp of entry.expectedSessions) {
    const d = entry.sessions[exp.sessionId];
    if (d?.failedStart) hasFailedStart = true;
    if (d?.complete) {
      sent += d.sent ?? 0;
      groups += d.total ?? 0;
      fail += (d.failed ?? 0) + (d.skipped ?? 0);
    }
  }
  return { sent, groups, fail, hasFailedStart };
}

function buildRunningText(entry) {
  const lines = entry.expectedSessions.map((exp) => sessionLine(exp, entry.sessions[exp.sessionId]));
  const preview = entry.textPreview
    ? `\n\n<b>Conteúdo:</b> ${entry.textPreview.slice(0, 180)}${entry.textPreview.length > 180 ? '…' : ''}`
    : '';
  const media = entry.mediaKind ? `\n📎 ${entry.mediaKind}` : '';
  return (
    '⏳ <b>Blast personalizado em andamento…</b>\n\n' +
    lines.join('\n') +
    preview +
    media +
    '\n\n<i>Atualiza aqui ao terminar.</i>'
  );
}

function buildCompleteText(entry) {
  const lines = entry.expectedSessions.map((exp) => sessionLine(exp, entry.sessions[exp.sessionId]));
  const { sent, groups, fail, hasFailedStart } = aggregate(entry);
  const sec = Math.round((Date.now() - entry.startedAt) / 1000);
  const allOk = fail === 0 && !hasFailedStart;
  const header = allOk
    ? `✅ <b>Blast personalizado concluído</b> (${sec}s)`
    : `⚠️ <b>Blast personalizado finalizado</b> (${sec}s)`;
  const media = entry.mediaKind ? `\n📎 ${entry.mediaKind}` : '';
  return (
    `${header}\n\n` +
    lines.join('\n') +
    `\n\n<b>Total:</b> ${sent} enviado(s) · ${fail} falha/pulado · ${groups} grupo(s)` +
    media
  );
}

function isAllDone(entry) {
  return entry.expectedSessions.every((exp) => {
    const d = entry.sessions[exp.sessionId];
    return d?.complete || d?.failedStart;
  });
}

function stopJobWatch(blastId) {
  const watch = jobWatches.get(blastId);
  if (watch?.timer) clearInterval(watch.timer);
  jobWatches.delete(blastId);
}

function register(blastId, meta) {
  prune();
  stopJobWatch(blastId);
  pending.set(blastId, {
    ...meta,
    sessions: meta.sessions || {},
    startedAt: meta.startedAt || Date.now(),
  });
}

function markFailedStart(blastId, sessionId, error) {
  const entry = pending.get(blastId);
  if (!entry) return;
  entry.sessions[sessionId] = {
    failedStart: true,
    error: String(error || 'falha').slice(0, 120),
    at: Date.now(),
  };
  refreshPanel(blastId).catch(() => {});
  if (isAllDone(entry)) {
    finalizeBlast(blastId).catch(() => {});
  }
}

async function refreshPanel(blastId) {
  const entry = pending.get(blastId);
  if (!entry?.panelRef || !botRef) return;
  const done = isAllDone(entry);
  const text = done ? buildCompleteText(entry) : buildRunningText(entry);
  const kb = done ? buildCompleteKeyboard() : buildRunningKeyboard();
  const r = await notifyBroadcastComplete(botRef.telegram, entry.panelRef, text, kb, {
    adminIds: [],
    userId: entry.adminId,
    tryEdit: !done,
  });
  if (!r?.ok) {
    loggerRef?.warn?.('[WA] blast painel não atualizou', {
      category: 'HANORK',
      module: 'WA',
      blastId,
      done,
    });
  }
}

async function finalizeBlast(blastId) {
  stopJobWatch(blastId);
  await refreshPanel(blastId);
  pending.delete(blastId);
  loggerRef?.info?.('[WA] blast painel admin concluído', {
    category: 'HANORK',
    module: 'WA',
    blastId,
  });
}

async function applyPostEvent(blastId, ev) {
  const entry = pending.get(blastId);
  if (!entry) return false;

  const sid = ev.waSessionId;
  if (!sid) return false;

  entry.sessions[sid] = {
    sent: ev.sent ?? 0,
    total: ev.total ?? 0,
    failed: ev.failed ?? 0,
    skipped: ev.skipped ?? 0,
    message: ev.message || null,
    error: ev.ok === false ? ev.message || 'falhou' : null,
    complete: true,
    at: Date.now(),
  };

  await refreshPanel(blastId);
  if (isAllDone(entry)) {
    await finalizeBlast(blastId);
  }
  return true;
}

async function handlePostEvent(ev) {
  if (ev.type !== 'wa.post' || ev.campaign !== 'custom-blast') return false;
  const blastId = parseBlastId(ev.jobId);
  if (!blastId) return false;
  return applyPostEvent(blastId, ev);
}

async function pollJobEvents(blastId) {
  const watch = jobWatches.get(blastId);
  const entry = pending.get(blastId);
  if (!watch || !entry) {
    stopJobWatch(blastId);
    return;
  }

  for (const job of watch.jobs) {
    if (entry.sessions[job.sessionId]?.complete || entry.sessions[job.sessionId]?.failedStart) {
      continue;
    }
    try {
      const client = getZeroDivuClient(job.sessionId);
      const eventsFile = client.files.events;
      if (!fs.existsSync(eventsFile)) continue;

      const offset = watch.offsets.get(job.sessionId) ?? 0;
      const { events, nextOffset } = await client.readEventsSince(offset);
      watch.offsets.set(job.sessionId, nextOffset);

      for (const ev of events) {
        if (ev.type !== 'wa.post' || ev.campaign !== 'custom-blast') continue;
        if (String(ev.jobId) !== String(job.jobId)) continue;
        ev.waSessionId = ev.waSessionId || job.sessionId;
        await applyPostEvent(blastId, ev);
        break;
      }
    } catch (e) {
      loggerRef?.warn?.(`[WA] blast poll ${job.sessionId}: ${e?.message || e}`);
    }
  }

  if (!pending.has(blastId)) {
    stopJobWatch(blastId);
  }
}

/**
 * Observa events.jsonl dos workers — fallback se o log bridge perder evento.
 * @param {string} blastId
 * @param {{ sessionId: string, jobId: string }[]} jobs
 */
function startJobWatch(blastId, jobs = []) {
  stopJobWatch(blastId);
  if (!jobs.length || !pending.has(blastId)) return;

  const offsets = new Map();
  for (const job of jobs) {
    try {
      const client = getZeroDivuClient(job.sessionId);
      const fp = client.files.events;
      offsets.set(job.sessionId, fs.existsSync(fp) ? fs.statSync(fp).size : 0);
    } catch {
      offsets.set(job.sessionId, 0);
    }
  }

  const timer = setInterval(() => {
    pollJobEvents(blastId).catch(() => {});
  }, 2500);
  if (timer.unref) timer.unref();

  jobWatches.set(blastId, { timer, jobs, offsets, startedAt: Date.now() });

  setTimeout(() => stopJobWatch(blastId), TTL_MS);
}

async function notifyError(panelRef, adminId, message, Markup) {
  if (!botRef || !panelRef) return;
  const kb = keyboardBuilder
    ? keyboardBuilder([
        [{ text: '📢 Tentar de novo', callback_data: 'a_wa_custom_blast' }],
        [{ text: '🔙 Painel WA', callback_data: 'a_wa_menu' }],
      ])
    : null;
  await notifyBroadcastComplete(
    botRef.telegram,
    panelRef,
    `❌ <b>Blast falhou</b>\n\n${message}`,
    kb,
    { adminIds: [], userId: adminId, tryEdit: false }
  );
}

module.exports = {
  init,
  register,
  markFailedStart,
  handlePostEvent,
  refreshPanel,
  notifyError,
  startJobWatch,
  buildCompleteKeyboard,
};
