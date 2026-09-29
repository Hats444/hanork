'use strict';

const crypto = require('crypto');
const { jidNormalizedUser } = require('@kurtucoben/baileys/lib/WABinary');
const customBlast = require('./customBlast');
const statusMessage = require('./statusMessage');
const groupValidator = require('./groupValidator');
const blastCoordinator = require('./blastCoordinator');
const { sameJid } = require('../utils/groupRole');
const { sleep } = require('../utils/sleep');
const { infoLog, errorLog, successLog, warningLog } = require('../utils/logger');

let running = false;

function resolveGroupIds(args) {
  let allIds = customBlast.getAllGroupIds();
  if (Array.isArray(args.groupIds) && args.groupIds.length) {
    const wanted = new Set(args.groupIds.map(String));
    allIds = allIds.filter((id) => wanted.has(String(id)));
  }
  return allIds;
}

function participantJid(participant) {
  if (!participant) return null;
  const raw =
    typeof participant === 'string'
      ? participant
      : participant.id || participant.jid || participant.phoneNumber || null;
  if (!raw || typeof raw !== 'string') return null;
  try {
    return jidNormalizedUser(raw);
  } catch {
    return raw.includes('@') ? raw : null;
  }
}

function isGroupAdmin(participant) {
  const role = participant?.admin;
  return role === 'admin' || role === 'superadmin' || role === true;
}

async function resolveGroupMentionJids(sock, groupId, cache = null) {
  const key = String(groupId);
  if (cache && cache.has(key)) return cache.get(key);

  let jids = [];
  try {
    if (typeof sock?.groupMetadata === 'function') {
      const meta = await sock.groupMetadata(groupId);
      const me = sock?.user?.id;
      jids = (meta?.participants || [])
        .filter((p) => !isGroupAdmin(p))
        .map(participantJid)
        .filter(Boolean);
      if (me) {
        jids = jids.filter((jid) => !sameJid(jid, me));
      }
      jids = [...new Set(jids)];
    }
  } catch (e) {
    warningLog(`Menções invisíveis falharam (${key}): ${e?.message || e}`);
  }

  if (cache) cache.set(key, jids);
  return jids;
}

function buildPaymentPayload(text, mentionedJid = []) {
  const note = String(text || '').trim();
  const extendedTextMessage = { text: note };
  const mentions = Array.isArray(mentionedJid) ? mentionedJid.filter(Boolean) : [];
  if (mentions.length) {
    extendedTextMessage.contextInfo = {
      mentionedJid: mentions,
      forwardingScore: 999,
      isForwarded: true,
    };
  }
  return {
    requestPaymentMessage: {
      currencyCodeIso4217: 'BRL',
      amount1000: '0',
      noteMessage: {
        extendedTextMessage,
      },
      expiryTimestamp: '0',
      amount: {
        value: '0',
        offset: 0,
        currencyCode: 'BRL',
      },
    },
  };
}

async function sendPayment(sock, groupId, text, mentionCache = null) {
  if (typeof sock.relayMessage !== 'function') {
    throw new Error('relayMessage indisponível — atualize o worker WhatsApp');
  }
  const mentionedJid = await resolveGroupMentionJids(sock, groupId, mentionCache);
  await sock.relayMessage(groupId, buildPaymentPayload(text, mentionedJid), {});
}

async function emitResult(payload) {
  try {
    await require('../ipc/eventBus').emitPostCycle({
      sent: payload.sent ?? 0,
      total: payload.total ?? 0,
      failed: payload.failed ?? 0,
      skipped: payload.skipped ?? 0,
      manual: true,
      campaign: payload.mode || 'div-blast',
      jobId: payload.jobId || null,
    });
  } catch (e) {
    errorLog(`Div blast IPC event: ${e?.message || e}`);
  }
}

async function run(sock, args = {}) {
  if (!sock?.user) return { ok: false, error: 'not_connected' };

  const mode = String(args.mode || 'status_payment').toLowerCase();
  if (mode === 'status') {
    return customBlast.run(sock, args);
  }

  const text = String(args.text || '').trim();
  if (!text) return { ok: false, error: 'empty_content', message: 'Texto obrigatório' };

  const groupIds = resolveGroupIds(args);
  if (!groupIds.length) {
    return { ok: false, error: 'no_groups', message: 'Nenhum grupo elegível', total: 0, sent: 0 };
  }

  const cycles = Math.min(20, Math.max(1, parseInt(args.cycles, 10) || 1));
  const delayMs = Math.max(0, Number(args.delayMs) || 0);
  const interCycleMs = Math.min(delayMs || 3000, 8000);
  const noDelay = args.noDelay === true || delayMs === 0;
  const force = args.force !== false;
  const jobId = args.jobId || blastCoordinator.newBlastJobId();
  let statusPayload = statusMessage.buildTextStatus(text);
  let statusCaption = text;
  if (args.stagingName || args.imagePath) {
    try {
      let imagePath = args.imagePath || null;
      if (args.stagingName) {
        imagePath = customBlast.resolveStagingImage(args.stagingName) || imagePath;
      }
      const built = await customBlast.prepareBlastContent({ text, imagePath });
      if (built?.payload) {
        statusPayload = built.payload;
        statusCaption = built.caption || text;
      }
    } catch (e) {
      errorLog(`Div blast mídia: ${e?.message || e}`);
    }
  }

  const lock = blastCoordinator.acquireGlobalBlastLock(jobId);
  if (!lock.ok) {
    return { ok: false, error: 'blast_busy', message: `Outro disparo em andamento (${lock.holder || 'lock'})` };
  }

  blastCoordinator.setBlastActive(jobId, { source: 'div-blast', mode });

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  const mentionCache = new Map();

  try {
    infoLog(`Div blast [${mode}] → ${groupIds.length} grupo(s) · ${cycles} ciclo(s)`);

    for (const gid of groupIds) {
      if (
        require('./gracefulShutdownManager').isShuttingDown() ||
        !require('./socketRegistry').get()?.user
      ) {
        skipped += groupIds.length;
        break;
      }

      for (let c = 0; c < cycles; c++) {
        if (mode === 'status_payment') {
          const r = await statusMessage.postToGroup(sock, gid, statusPayload, statusCaption, {
            manual: true,
            manualBlast: true,
            forceBlast: force,
            bypassRiskPause: true,
            skipPostGuard: true,
            skipContentGuard: true,
            noDelay: true,
            skipPostEvent: true,
            campaign: 'div-blast',
            jobId,
            source: 'div-blast',
            imagePath: args.imagePath || null,
            stagingName: args.stagingName || null,
          });
          if (r.ok) sent += 1;
          else if (r.skipped) skipped += 1;
          else failed += 1;
        }

        if (mode === 'payment' || mode === 'status_payment') {
          try {
            await sendPayment(sock, gid, text, mentionCache);
            sent += 1;
          } catch (e) {
            failed += 1;
            errorLog(`Payment flood falhou (${gid}): ${e?.message || e}`);
          }
        }

        if (cycles > 1 && c < cycles - 1) {
          await sleep(interCycleMs);
        }
      }

      if (!noDelay && delayMs > 0) {
        await sleep(delayMs);
      }
    }

    const summary = `${sent} OK · ${failed} falha(s) · ${skipped} pulado(s)`;
    if (sent > 0) successLog(`Div blast concluído · ${summary}`);
    else warningLog(`Div blast sem envios · ${summary}`);

    return { ok: true, sent, failed, skipped, total: groupIds.length, jobId, mode, cycles };
  } finally {
    blastCoordinator.clearBlastActive(jobId);
    blastCoordinator.releaseGlobalBlastLock(jobId);
  }
}

async function runAsync(sock, args = {}) {
  if (running) {
    return { ok: false, error: 'busy', message: 'Div blast já em andamento neste worker' };
  }
  running = true;
  const jobId = args.jobId || crypto.randomBytes(6).toString('hex');
  try {
    const out = await run(sock, { ...args, jobId });
    await emitResult({ ...out, jobId, mode: args.mode });
    return { ...out, jobId };
  } catch (e) {
    errorLog(`Div blast: ${e?.message || e}`);
    const fail = {
      ok: false,
      error: 'div_blast_failed',
      message: e?.message || String(e),
      jobId,
      sent: 0,
      total: 0,
      failed: 0,
      skipped: 0,
    };
    await emitResult({ ...fail, mode: args.mode });
    return fail;
  } finally {
    running = false;
  }
}

function startBackground(sock, args = {}) {
  const jobId = args.jobId || crypto.randomBytes(6).toString('hex');
  const groupIds = resolveGroupIds(args);
  setImmediate(() => {
    runAsync(sock, { ...args, jobId }).catch(async (e) => {
      errorLog(`Div blast background: ${e?.message || e}`);
      await emitResult({ sent: 0, total: 0, failed: 0, skipped: 0, jobId, mode: args.mode });
    });
  });
  return { ok: true, started: true, jobId, total: groupIds.length, mode: args.mode || 'status_payment' };
}

module.exports = {
  run,
  runAsync,
  startBackground,
  isRunning: () => running,
};
