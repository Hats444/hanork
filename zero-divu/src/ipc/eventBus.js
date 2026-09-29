'use strict';

const fs = require('fs-extra');
const { FILES, ensureDir } = require('./paths');
const { writeStateSnapshot } = require('./stateWriter');

let appendChain = Promise.resolve();

function sessionId() {
  return process.env.WA_SESSION_ID || 'wa_a';
}

function appendEvent(event) {
  ensureDir();
  const line = JSON.stringify({
    ...event,
    waSessionId: event.waSessionId || sessionId(),
    at: event.at || new Date().toISOString(),
  });
  appendChain = appendChain.then(async () => {
    await fs.appendFile(FILES.events, `${line}\n`, 'utf8');
  });
  return appendChain;
}

exports.emitQr = async ({ pngBase64, filePath }) => {
  await appendEvent({ type: 'wa.qr', pngBase64, filePath });
};

exports.emitPairingCode = async ({ phone, code, formatted }) => {
  await appendEvent({
    type: 'wa.pairing_code',
    phone: phone || null,
    code: code || null,
    formatted: formatted || null,
  });
  try {
    const { infoLog } = require('../utils/logger');
    infoLog(`pairing · código ${formatted || code || '?'} · ${phone || '?'}`);
  } catch {
    /* ignore */
  }
};

exports.emitConnected = async ({ phone }) => {
  await appendEvent({ type: 'wa.connected', phone: phone || null });
  await writeStateSnapshot({ connected: true, phone: phone || null });
};

exports.emitDisconnected = async ({ reason } = {}) => {
  await appendEvent({ type: 'wa.disconnected', reason: reason || 'unknown' });
  await writeStateSnapshot({ connected: false, phone: null });
};

exports.emitPostCycle = async ({
  sent = 0,
  total = 0,
  failed = 0,
  skipped = 0,
  index = 0,
  partial = false,
  done = false,
  campaign,
  manual,
  group,
  jobId = null,
  message = null,
  ok = true,
}) => {
  await appendEvent({
    type: 'wa.post',
    sent,
    total,
    failed,
    skipped,
    index,
    partial: Boolean(partial),
    done: Boolean(done),
    campaign: campaign || null,
    manual: Boolean(manual),
    group: group || null,
    jobId: jobId || null,
    message: message || null,
    ok: ok !== false,
  });
};

exports.emitJoinStart = async ({ link, queuePos, queueTotal }) => {
  await appendEvent({
    type: 'wa.join.start',
    link: link ? String(link).slice(0, 24) : null,
    queuePos,
    queueTotal,
  });
};

exports.emitJoinOk = async ({ group, active, max }) => {
  await appendEvent({ type: 'wa.join.ok', group, active, max });
};

exports.emitJoinLimit = async ({ reason, pauseMin, active, max }) => {
  await appendEvent({ type: 'wa.join.limit', reason, pauseMin, active, max });
};

exports.emitLeave = async ({ group, reason }) => {
  await appendEvent({ type: 'wa.leave', group, reason });
};

exports.emitManualJoin = async ({
  group,
  gid = null,
  size = null,
  announce = null,
  statusHint = null,
  source = 'realtime',
  active = null,
  max = null,
  reentry = false,
}) => {
  await appendEvent({
    type: 'wa.manual_join',
    group,
    gid,
    size,
    announce,
    statusHint,
    source,
    active,
    max,
    reentry: Boolean(reentry),
  });
};

exports.emitStatusBlocked = async ({ group, reason, manualJoin = false, size = null }) => {
  await appendEvent({ type: 'wa.status_blocked', group, reason, manualJoin: Boolean(manualJoin), size });
};

exports.emitCap = async ({ active, max }) => {
  await appendEvent({ type: 'wa.cap', active, max });
};

exports.appendEvent = appendEvent;
