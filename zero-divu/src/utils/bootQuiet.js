'use strict';

/** Suprime logs INFO repetitivos durante boot/reconnect; emite um resumo ao finalizar. */

let active = false;
let until = 0;
const inviteStats = { dup: 0, new: 0, skipped: 0 };
const lines = [];

function expired() {
  return active && Date.now() > until;
}

function verbose() {
  return process.env.LOG_VERBOSE === '1' || process.env.ZERO_LOG_VERBOSE === '1';
}

exports.enter = (ms = 120000) => {
  active = true;
  until = Date.now() + ms;
  inviteStats.dup = 0;
  inviteStats.new = 0;
  inviteStats.skipped = 0;
  lines.length = 0;
};

exports.extend = (ms = 60000) => {
  until = Math.max(until, Date.now() + ms);
};

exports.isQuiet = () => active && !expired();

exports.bumpInvite = (kind = 'new') => {
  if (!exports.isQuiet()) return;
  if (kind === 'dup') inviteStats.dup++;
  else if (kind === 'skipped') inviteStats.skipped++;
  else inviteStats.new++;
};

/** Durante boot: acumula linha; LOG_VERBOSE=1 emite na hora. */
exports.bootInfo = (infoLog, msg) => {
  const text = String(msg || '').trim();
  if (!text) return;
  if (verbose() && typeof infoLog === 'function') {
    infoLog(text);
    return;
  }
  if (exports.isQuiet()) {
    lines.push(text);
    return;
  }
  if (typeof infoLog === 'function') infoLog(text);
};

exports.flushInvites = (infoLog) => {
  /* compat — resumo real sai em flushBoot/exit */
  if (!exports.isQuiet() && infoLog) {
    const total = inviteStats.dup + inviteStats.new + inviteStats.skipped;
    if (total === 0) return;
    const parts = [];
    if (inviteStats.new) parts.push(`${inviteStats.new} enfileirado(s)`);
    if (inviteStats.dup) parts.push(`${inviteStats.dup} já na fila`);
    if (inviteStats.skipped) parts.push(`${inviteStats.skipped} ignorado(s)`);
    infoLog(`Fila join (boot): ${parts.join(' · ')}`);
    inviteStats.dup = 0;
    inviteStats.new = 0;
    inviteStats.skipped = 0;
  }
};

exports.flushBoot = (infoLog) => {
  const parts = [];
  const invTotal = inviteStats.dup + inviteStats.new + inviteStats.skipped;
  if (invTotal > 0) {
    const ip = [];
    if (inviteStats.new) ip.push(`${inviteStats.new} enfileirado(s)`);
    if (inviteStats.dup) ip.push(`${inviteStats.dup} já na fila`);
    if (inviteStats.skipped) ip.push(`${inviteStats.skipped} ignorado(s)`);
    parts.push(`convites ${ip.join(', ')}`);
    inviteStats.dup = 0;
    inviteStats.new = 0;
    inviteStats.skipped = 0;
  }
  if (lines.length) parts.push(...lines);
  lines.length = 0;

  if (!parts.length || typeof infoLog !== 'function') return;
  if (parts.length === 1) infoLog(parts[0]);
  else infoLog(`Boot Zero: ${parts.join(' · ')}`);
};

exports.exit = (infoLog) => {
  exports.flushBoot(infoLog);
  active = false;
  until = 0;
};
