'use strict';

const path = require('path');
const fs = require('fs-extra');
const crypto = require('crypto');
const statusMessage = require('./statusMessage');
const groupValidator = require('./groupValidator');
const groupMembership = require('./groupMembership');
const { sanitizeWaCaption } = require('../utils/statusCaptionSanitizer');
const { successLog, warningLog, infoLog, errorLog } = require('../utils/logger');
const { IPC_DIR } = require('../ipc/paths');
const pathResolver = require('../utils/pathResolver');
const blastCoordinator = require('./blastCoordinator');

let running = false;

async function emitBlastResult(payload) {
  try {
    await require('../ipc/eventBus').emitPostCycle({
      sent: payload.sent ?? 0,
      total: payload.total ?? 0,
      failed: payload.failed ?? 0,
      skipped: payload.skipped ?? 0,
      manual: true,
      campaign: 'custom-blast',
      jobId: payload.jobId || null,
      message: payload.message || payload.error || null,
      ok: payload.ok !== false,
    });
    const hint = payload.message || payload.error;
    infoLog(
      `Blast IPC event · job=${payload.jobId || '?'} · ${payload.sent ?? 0}/${payload.total ?? 0} OK` +
        (hint ? ` · ${hint}` : '')
    );
  } catch (e) {
    errorLog(`Blast IPC event: ${e?.message || e}`);
  }
}

function getAllGroupIds() {
  const all = groupValidator.listSortedByScore();
  let groups = groupMembership.filterInWhatsApp(all);
  if (!groups.length && all.length) {
    warningLog(
      `Blast manual: filtro WhatsApp removeu todos os ${all.length} grupo(s) — usando registro completo`
    );
    groups = all;
  }
  return [...new Set(groups.map((g) => g.id).filter(Boolean))];
}

function filterBlastTargets(ids, minGapMs, { force = false } = {}) {
  if (force) {
    return { eligible: ids, skippedRecent: 0, skippedGuard: 0 };
  }

  const postGuard = require('./postGuard');
  const active = groupValidator.loadActiveGroups();
  const eligible = [];
  let skippedRecent = 0;
  let skippedGuard = 0;

  for (const jid of ids) {
    const row = active[jid] || {};
    if (!blastCoordinator.canBlastGroup(jid, row, minGapMs)) {
      skippedRecent += 1;
      continue;
    }
    const check = postGuard.canPostToGroup(jid, { manualBlast: true });
    if (!check.ok) {
      skippedGuard += 1;
      continue;
    }
    eligible.push(jid);
  }

  return { eligible, skippedRecent, skippedGuard };
}

function resolveStagingImage(stagingName) {
  if (!stagingName) return null;
  const src = path.join(IPC_DIR, 'inbox', path.basename(String(stagingName)));
  if (!fs.existsSync(src)) return null;
  const dir = path.join(pathResolver.getMediaDir(), 'custom-blast');
  fs.ensureDirSync(dir);
  const dest = path.join(dir, `${Date.now()}-${path.basename(src)}`);
  fs.copyFileSync(src, dest);
  return dest;
}

async function buildPayload({ text, imagePath }) {
  const caption = sanitizeWaCaption(String(text || '').trim());
  if (imagePath && (await fs.pathExists(imagePath))) {
    const ext = path.extname(imagePath).toLowerCase();
    const isVideo = ['.mp4', '.mov', '.webm', '.mkv'].includes(ext);
    const payload = await statusMessage.buildFromLocal({
      type: isVideo ? 'video' : 'image',
      file: imagePath,
      caption: '',
    });
    if (payload) return { payload, caption };
  }
  return { payload: statusMessage.buildTextStatus(caption), caption };
}

const BLAST_OPTS = {
  manual: true,
  source: 'custom-blast',
  campaign: 'custom-blast',
  noDelay: true,
  skipPostGuard: true,
  skipGuard: false,
  skipContentGuard: true,
  forceBlast: true,
  bypassRiskPause: true,
  skipChatMirror: true,
  manualBlast: true,
  skipPostEvent: true,
};

async function run(sock, args = {}) {
  if (!sock?.user) return { ok: false, error: 'not_connected' };

  const text = String(args.text || '').trim();
  let imagePath = args.imagePath || null;
  if (args.stagingName) {
    imagePath = resolveStagingImage(args.stagingName) || imagePath;
  }

  if (!text && !imagePath) {
    return { ok: false, error: 'empty_content', message: 'Envie texto ou mídia' };
  }

  const force = args.force !== false;
  const minGapMs = force ? 0 : blastCoordinator.defaultMinGapMs();
  const jobId = args.jobId || blastCoordinator.newBlastJobId();
  const lock = blastCoordinator.acquireGlobalBlastLock(jobId);
  if (!lock.ok) {
    return {
      ok: false,
      error: 'blast_busy',
      message: `Outro blast em andamento (${lock.holder || 'lock'})`,
    };
  }

  blastCoordinator.setBlastActive(jobId, { source: 'custom-blast', force });

  try {
    let allIds = getAllGroupIds();
    if (Array.isArray(args.groupIds) && args.groupIds.length) {
      const wanted = new Set(args.groupIds.map(String));
      allIds = allIds.filter((id) => wanted.has(String(id)));
    }
    if (!allIds.length) {
      const fail = {
        ok: false,
        error: 'no_groups',
        message: 'Nenhum grupo registrado — sincronize grupos no painel WA',
        total: 0,
        sent: 0,
      };
      return fail;
    }

    const { eligible, skippedRecent, skippedGuard } = filterBlastTargets(allIds, minGapMs, { force });
    const ids = eligible;
    if (!ids.length) {
      return {
        ok: false,
        error: 'no_eligible_groups',
        message: force
          ? 'Nenhum grupo elegível para blast'
          : 'Todos os grupos já receberam post recentemente — aguarde o cooldown',
        total: allIds.length,
        sent: 0,
        skippedRecent,
        skippedGuard,
      };
    }

    const { payload, caption } = await buildPayload({ text, imagePath });
    if (!payload && !caption) {
      return { ok: false, error: 'empty_payload', total: ids.length, sent: 0 };
    }

    const useDelay = args.noDelay === false;
    infoLog(
      `Blast manual → ${ids.length}/${allIds.length} grupo(s) · ` +
        (useDelay ? 'com delay' : 'sem delay') +
        (!force && skippedRecent + skippedGuard > 0
          ? ` · ${skippedRecent + skippedGuard} pulado(s)`
          : '')
    );

    const blastOpts = {
      ...BLAST_OPTS,
      noDelay: !useDelay,
      imagePath,
      jobId,
      forceBlast: force,
    };

    const stats = await statusMessage.broadcastToGroups(
      sock,
      payload,
      ids,
      (gid, ok) => {
        if (ok && !force) blastCoordinator.recordBlastPost(gid, jobId);
        groupValidator.recordPostResult(gid, ok, {
          campaignId: 'custom-blast',
          mediaKey: ok ? 'custom-blast' : undefined,
        });
      },
      caption,
      blastOpts
    );

    const pending = Math.max(0, ids.length - stats.sent - stats.skipped - stats.failed);
    const summary = `${stats.sent} OK · ${stats.skipped} pulado(s) · ${stats.failed} falha(s) · ${ids.length} total`;
    if (stats.sent > 0) {
      successLog(`Blast manual concluído · ${summary}`);
    } else {
      warningLog(`Blast manual sem envios · ${summary}`);
    }
    if (pending > 0) {
      warningLog(`Blast manual incompleto — ${pending} grupo(s) não processado(s)`);
    }

    return {
      ok: true,
      sent: stats.sent,
      failed: stats.failed,
      skipped: stats.skipped,
      total: ids.length,
      skippedRecent,
      skippedGuard,
      jobId,
      force,
    };
  } finally {
    blastCoordinator.clearBlastActive(jobId);
    blastCoordinator.releaseGlobalBlastLock(jobId);
  }
}

async function runAsync(sock, args = {}) {
  if (running) {
    return { ok: false, error: 'busy', message: 'Blast já em andamento neste worker' };
  }
  running = true;
  const jobId = args.jobId || crypto.randomBytes(6).toString('hex');
  const force = args.force !== false;
  try {
    const out = await run(sock, { ...args, jobId });
    await emitBlastResult({ ...out, jobId });
    return { ...out, jobId };
  } catch (e) {
    errorLog(`Blast personalizado: ${e?.message || e}`);
    const fail = { ok: false, error: 'blast_failed', message: e?.message || String(e), jobId, sent: 0, total: 0, failed: 0, skipped: 0 };
    await emitBlastResult({ ...fail, jobId });
    return fail;
  } finally {
    running = false;
  }
}

function startBackground(sock, args = {}) {
  const jobId = args.jobId || crypto.randomBytes(6).toString('hex');
  const total = getAllGroupIds().length;
  setImmediate(() => {
    runAsync(sock, { ...args, jobId, force: args.force !== false }).catch(async (e) => {
      errorLog(`Blast background: ${e?.message || e}`);
      await emitBlastResult({ sent: 0, total: 0, failed: 0, skipped: 0, jobId });
    });
  });
  return { ok: true, started: true, jobId, total };
}

module.exports = {
  getAllGroupIds,
  run,
  runAsync,
  startBackground,
  isRunning: () => running,
  prepareBlastContent: buildPayload,
  resolveStagingImage,
};
