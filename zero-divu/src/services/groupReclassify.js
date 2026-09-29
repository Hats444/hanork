'use strict';

const crypto = require('crypto');
const cfg = require('../config/divulgacao');
const groupProfile = require('./groupProfile');
const groupClassifier = require('./groupClassifier');
const groupValidator = require('./groupValidator');
const groupOnboarding = require('./groupOnboarding');
const labels = require('../utils/groupLabels');
const { sleep } = require('../utils/sleep');
const logThrottle = require('../utils/logThrottle');
const { infoLog, successLog, warningLog, section } = require('../utils/logger');

let cycleRunning = false;
let abortToken = 0;
let stableTimer = null;
const pendingJids = new Set();
let pendingTimer = null;

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

exports.isAborted = (token) => token !== abortToken;

exports.profileFingerprint = (profile) => {
  const payload = [
    normalize(profile.subject || ''),
    normalize(profile.desc || profile.description || ''),
    profile.announce === true ? 'a1' : profile.announce === false ? 'a0' : 'ax',
  ].join('\n');
  return crypto.createHash('sha1').update(payload).digest('hex').slice(0, 16);
};

function wasChatVisited(jid) {
  const inv = groupValidator.loadInvalidGroups();
  const r = inv[jid]?.reason || '';
  return r.includes('chat normal') || r.includes('visita única');
}

function socketReady(sock) {
  return groupProfile.isSocketOnline(sock);
}

function shouldReclassify(active, profile, { force = false } = {}) {
  if (!active || active.pendingApproval || active.visitOnly) return false;
  if (!cfg.ENABLE_GROUP_CLASSIFIER) return false;

  const fp = exports.profileFingerprint(profile);
  if (force) return true;
  if (fp !== active.classifyFingerprint) return true;

  const minMs = cfg.GROUP_RECLASSIFY_MIN_INTERVAL_MS || 6 * 60 * 60 * 1000;
  const last = active.classifiedAt ? new Date(active.classifiedAt).getTime() : 0;
  if (Date.now() - last >= minMs) return true;

  return false;
}

/** Interrompe lotes em andamento (reconnect / pause) */
exports.pause = () => {
  abortToken++;
  cycleRunning = false;
  if (stableTimer) {
    clearTimeout(stableTimer);
    stableTimer = null;
  }
};

exports.reclassifyOne = async (sock, gid, hints = {}, opts = {}) => {
  const token = opts.abortToken ?? abortToken;
  if (exports.isAborted(token)) return { skipped: true, gid, reason: 'aborted' };

  if (!gid || !cfg.ENABLE_GROUP_CLASSIFIER) return null;
  if (wasChatVisited(gid)) return null;

  const active = groupValidator.loadActiveGroups()[gid];
  if (!active && !opts.allowNew) return null;
  if (active?.pendingApproval || active?.visitOnly) return null;

  if (!socketReady(sock)) {
    exports.enqueue(gid);
    return { skipped: true, gid, reason: 'offline' };
  }

  const profile = await groupProfile.collect(
    sock,
    gid,
    {
      subject: hints.subject ?? active?.subject,
      desc: hints.desc ?? active?.desc,
      announce: hints.announce ?? active?.announce,
      size: hints.size ?? active?.size,
      isCommunity: hints.isCommunity,
    },
    { forceFetch: opts.forceLive === true }
  );

  if (exports.isAborted(token)) return { skipped: true, gid, reason: 'aborted' };

  const hasDesc = groupProfile.hasUsableDescription(profile, active);
  const metaFailed = !profile.metadataFetched && profile.metadataError;

  if (metaFailed && !hasDesc) {
    if (groupProfile.isAccessDeniedError(profile.metadataError)) {
      if (!require('./groupBanGuard').isRateOrTransient(profile.metadataError)) {
        await require('./forbiddenCleanup').onForbiddenDetected(
          sock,
          gid,
          profile.metadataError || 'forbidden'
        );
      }
      return { skipped: true, gid, reason: 'forbidden_removed' };
    }
    groupValidator.registerGroup(gid, {
      classifyPendingVerify: true,
      classifyPendingReason: profile.metadataError || 'sem descrição',
    });
    return { skipped: true, gid, reason: 'metadata_unavailable' };
  }

  if (!shouldReclassify(active, profile, opts)) return { skipped: true, gid };

  const prevType = active?.groupType || null;
  const result = groupClassifier.classify(profile);
  const name = labels.displayName(profile, labels.shortId(gid));
  const fp = exports.profileFingerprint(profile);

  const newType = result.groupType || result.type;

  groupValidator.registerGroup(gid, {
    subject: profile.subject,
    desc: profile.desc ? String(profile.desc).slice(0, 500) : undefined,
    announce: profile.announce,
    size: profile.size,
    groupType: newType,
    postPermission: result.postPermission,
    classifyAction: result.action,
    classifyConfidence: result.confidence,
    classifyDivScore: result.divScore,
    classifyChatScore: result.chatScore,
    classifyReason: result.reason,
    classifyReasons: (result.reasons || []).slice(0, 14),
    classifyLayersSummary: result.layers
      ? {
          contentDiv: result.layers.content?.divScore,
          contentChat: result.layers.content?.chatScore,
          rulesBan: result.layers.rules?.banScore,
          rulesAllow: result.layers.rules?.allowScore,
        }
      : undefined,
    classifyFingerprint: fp,
    classifiedAt: new Date().toISOString(),
    lastReclassifiedAt: new Date().toISOString(),
    classifyPendingVerify: false,
    classifyPendingReason: null,
    classifyTrustLevel: result.trustLevel || null,
    classifyMetadataQuality: result.metadataQuality || null,
  });

  const prevDenied = active?.postPermission === 'denied';
  const nowDenied = result.postPermission === 'denied';

  if (prevType && prevType !== newType) {
    warningLog(
      `Regra alterada: ${name} · ${labels.typeLabel(prevType)} → ${labels.typeLabel(newType)} · ${groupClassifier.formatVerdictLog(result)}`
    );

    if (
      (prevType === 'divulgacao' || prevType === 'mixed') &&
      (newType === 'chat' || result.action === 'visit_once')
    ) {
      await groupOnboarding.postOnceAndLeave(sock, gid, profile.subject);
      return { changed: true, from: prevType, to: newType, action: 'left' };
    }

    if (prevType === 'chat' && newType === 'divulgacao' && result.postPermission === 'allowed') {
      successLog(`Grupo voltou a permitir divulgação: ${name}`);
      return { changed: true, from: prevType, to: newType, action: 'stay' };
    }
  } else if (!prevDenied && nowDenied) {
    warningLog(`Divulgação bloqueada em ${name} — ${result.reason}`);
    await groupOnboarding.postOnceAndLeave(sock, gid, profile.subject);
    return { changed: true, action: 'left', reason: 'permission_denied' };
  } else if (logThrottle.shouldLog(`reclassify-${gid}`, 30 * 60 * 1000)) {
    debugReclassify(name, result, fp !== active?.classifyFingerprint);
  }

  return { changed: false, type: newType, gid };
};

function debugReclassify(name, result, metadataChanged) {
  if (!metadataChanged) return;
  infoLog(
    `Reclassificado: ${name} → ${labels.typeLabel(result.groupType || result.type)} (${result.confidence}) · ${groupClassifier.formatVerdictLog(result)}`
  );
}

exports.runCycle = async (sock, opts = {}) => {
  if (!cfg.ENABLE_AUTO_RECLASSIFY || !cfg.ENABLE_GROUP_CLASSIFIER) return;
  if (!socketReady(sock)) {
    if (logThrottle.shouldLog('reclassify-offline', 120000)) {
      infoLog('Reclassificação adiada — WhatsApp offline ou pausado');
    }
    return;
  }
  if (cycleRunning) {
    if (logThrottle.shouldLog('reclassify-busy')) infoLog('Reclassificação já em andamento');
    return;
  }

  const token = abortToken;
  cycleRunning = true;
  const onlyUnclassified = opts.onlyUnclassified === true;
  let checked = 0;
  let updated = 0;
  let changed = 0;

  try {
    const active = groupValidator.loadActiveGroups();
    const forbiddenCleanup = require('./forbiddenCleanup');
    const entries = Object.entries(active).filter(([, g]) => {
      if (g.pendingApproval || g.visitOnly) return false;
      if (forbiddenCleanup.isForbiddenRecord(g)) return false;
      if (onlyUnclassified && g.groupType) return false;
      return true;
    });

    if (!entries.length) return;

    section(`Reclassificação automática (${entries.length} grupo(s))`);

    for (const [jid, g] of entries) {
      if (exports.isAborted(token) || !socketReady(sock)) break;

      const res = await exports.reclassifyOne(sock, jid, g, {
        force: onlyUnclassified,
        abortToken: token,
      });
      checked++;
      if (res && !res.skipped) {
        updated++;
        if (res.changed) changed++;
      }
      await sleep(cfg.GROUP_RECLASSIFY_DELAY_MS || cfg.GROUP_CLASSIFY_DELAY_MS || 8000);
    }

    if (!exports.isAborted(token)) {
      successLog(`Reclassificação: ${checked} analisado(s), ${updated} atualizado(s), ${changed} mudança(s) de tipo`);
    }
  } finally {
    cycleRunning = false;
  }
};

exports.dropPending = (jid) => {
  if (!jid) return;
  pendingJids.delete(jid);
};

exports.enqueue = (jid) => {
  if (!jid || !cfg.ENABLE_AUTO_RECLASSIFY) return;
  const g = groupValidator.loadActiveGroups()[jid];
  if (require('./forbiddenCleanup').isForbiddenRecord(g)) return;
  pendingJids.add(jid);
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
  }, cfg.GROUP_RECLASSIFY_DEBOUNCE_MS || 180000);
};

exports.flushPending = async (sock) => {
  if (!pendingJids.size) return;

  if (!socketReady(sock)) {
    if (logThrottle.shouldLog('reclassify-pending-offline', 120000)) {
      infoLog(
        `Reclassificação pendente: ${pendingJids.size} grupo(s) — aguardando WhatsApp online`
      );
    }
    return;
  }

  const token = abortToken;
  const batch = [...pendingJids];
  pendingJids.clear();
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }

  const maxBatch = cfg.CLASSIFY_BATCH_MAX ?? 5;
  const slice = batch.slice(0, maxBatch);
  for (const jid of batch.slice(maxBatch)) pendingJids.add(jid);

  if (logThrottle.shouldLog('reclassify-batch')) {
    infoLog(
      `Reclassificando ${slice.length} grupo(s) (cache · ${pendingJids.size} na fila)…`
    );
  }

  let done = 0;
  let skipped = 0;

  for (let i = 0; i < slice.length; i++) {
    const jid = slice[i];
    if (exports.isAborted(token) || !socketReady(sock)) {
      for (let j = i; j < slice.length; j++) pendingJids.add(slice[j]);
      break;
    }

    const g = groupValidator.loadActiveGroups()[jid];
    const res = await exports.reclassifyOne(sock, jid, g || {}, {
      forceLive: false,
      abortToken: token,
    });

    if (res?.skipped && (res.reason === 'offline' || res.reason === 'aborted')) {
      pendingJids.add(jid);
    } else if (res?.skipped) {
      skipped++;
    } else if (res) {
      done++;
    }

    await sleep(cfg.GROUP_RECLASSIFY_DELAY_MS || 8000);
  }

  if (done || skipped) {
    infoLog(
      `Reclassificação em lote: ${done} ok · ${skipped} ignorado(s) · ${pendingJids.size} pendente(s)`
    );
  }
};

/** Aguarda conexão estável antes de classificar (evita rajada durante 440) */
exports.scheduleWhenStable = (sock) => {
  if (stableTimer) return;

  const minDelay = cfg.CLASSIFY_INITIAL_DELAY_MS ?? 90000;
  const stableMs = cfg.CLASSIFY_STABLE_CONNECTION_MS ?? 45000;
  let stableSince = null;
  const token = abortToken;

  const tick = () => {
    if (exports.isAborted(token)) {
      stableTimer = null;
      return;
    }

    if (!socketReady(sock)) {
      stableSince = null;
      stableTimer = setTimeout(tick, 8000);
      return;
    }

    if (!stableSince) stableSince = Date.now();

    if (Date.now() - stableSince >= stableMs) {
      stableTimer = null;
      exports.runInitialClassification(sock).catch(() => {});
      return;
    }

    stableTimer = setTimeout(tick, 5000);
  };

  stableTimer = setTimeout(tick, minDelay);
};

exports.runInitialClassification = async (sock) => {
  if (!socketReady(sock)) {
    exports.scheduleWhenStable(sock);
    return;
  }

  try {
    if (!require('./processRuntime').isReconnectBoot()) {
      exports.auditStoredClassifications();
    }
  } catch {
    exports.auditStoredClassifications();
  }

  await exports.runCycle(sock, { onlyUnclassified: true });
  await exports.flushPending(sock);
};

exports.detectChangesFromSync = (waGroup, prev) => {
  if (!prev || !waGroup?.id) return false;
  const desc = String(waGroup.desc || '');
  const prevDesc = String(prev.desc || '');
  if (desc !== prevDesc) return true;
  if ((waGroup.subject || '') !== (prev.subject || '')) return true;
  if (waGroup.announce !== undefined && waGroup.announce !== prev.announce) return true;
  return false;
};

exports.forceReset = () => {
  exports.pause();
  pendingJids.clear();
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
};

/** Revalida grupos com permissão inferida (não em todo reconnect) */
exports.auditStoredClassifications = () => {
  if (!cfg.ENABLE_GROUP_CLASSIFIER) return 0;
  if (cfg.GROUP_CLASSIFY_REQUIRE_EXPLICIT_ALLOW === false) return 0;

  const active = groupValidator.loadActiveGroups();
  let queued = 0;

  for (const [jid, g] of Object.entries(active)) {
    if (g.pendingApproval || g.visitOnly || g.postPermission === 'denied') continue;
    if (require('./forbiddenCleanup').isForbiddenRecord(g)) continue;
    if (g.classifyPendingVerify && g.postPermission === 'unknown') continue;

    const reason = String(g.classifyReason || '');
    const inferredOpen =
      g.postPermission === 'allowed' &&
      (g.classifyTrustLevel === 'inferred' ||
        !g.classifyTrustLevel ||
        reason.includes('sem descrição') ||
        reason.includes('padrão aberto') ||
        reason.includes('sem sinais fortes'));

    if (!inferredOpen) continue;

    const hasCachedDesc =
      (g.desc && String(g.desc).length >= 12) ||
      Boolean(require('./groupMetadataCache').get(jid)?.desc);

    groupValidator.registerGroup(jid, {
      postPermission: 'unknown',
      classifyAction: 'stay_cautious',
      classifyPendingVerify: true,
      classifyPendingReason: 'auditoria — revalidando regras',
    });

    if (hasCachedDesc) exports.enqueue(jid);
    queued++;
  }

  if (queued) {
    infoLog(
      `Auditoria: ${queued} grupo(s) marcados · fila ${pendingJids.size} (classifica com cache quando online)`
    );
  }
  return queued;
};

module.exports = exports;
