'use strict';

const path = require('path');
const fs = require('fs-extra');
const { generateWAMessageContent } = require('@kurtucoben/baileys/lib/Utils');
const mediaFinder = require('../utils/mediaFinder');
const mediaCache = require('../utils/mediaCache');
const antiBan = require('./antiBan');
const operationalLimits = require('./operationalLimits');
const floodGuard = require('./floodGuard');
const postGuard = require('./postGuard');
const risk = require('./riskController');
const labels = require('../utils/groupLabels');
const groupRole = require('../utils/groupRole');
const groupValidator = require('./groupValidator');
const cfg = require('../config/divulgacao');
const { sleep } = require('../utils/sleep');
const { withTimeout } = require('../utils/withTimeout');
const logThrottle = require('../utils/logThrottle');
const { errorLog, infoLog, successLog, warningLog } = require('../utils/logger');
const { appendWaOpsEvent } = require('../utils/opsMetrics');
const announceOnlyLeave = require('./announceOnlyLeave');

function sendTimeoutMs(announceMember = false) {
  if (announceMember) {
    return cfg.STATUS_ANNOUNCE_MEMBER_TIMEOUT_MS ?? 50000;
  }
  return cfg.SEND_STATUS_TIMEOUT_MS ?? 120000;
}

function isTimeoutError(message) {
  return /excedeu|timed out|timeout/i.test(String(message || ''));
}

function buildTextStatus(text) {
  const caption = (text || '').trim();
  if (!caption) return null;
  return { text: caption };
}

function buildMediaContent(item, filePath, buffer) {
  const caption = item.caption || '';
  const mimetype = item.mimetype || mediaFinder.guessMime(filePath);

  if (item.type === 'image') {
    return { image: buffer, mimetype, caption };
  }
  if (item.type === 'video') {
    return {
      video: buffer,
      mimetype,
      gifPlayback: Boolean(item.gifPlayback),
      caption,
    };
  }
  if (item.type === 'audio') {
    return { audio: buffer, mimetype };
  }
  return null;
}

async function buildFromLocal(item) {
  if (!item || item.type === 'text') return null;

  let filePath = null;
  let buffer = null;
  if (item.file && path.isAbsolute(String(item.file)) && (await fs.pathExists(item.file))) {
    filePath = item.file;
    buffer = await fs.readFile(item.file);
  } else {
    const cached = await mediaCache.getMediaBuffer(item.type, item.file);
    filePath = cached.filePath;
    buffer = cached.buffer;
  }

  if (!filePath || !buffer) {
    if (logThrottle.shouldLog('sem-midia')) {
      warningLog(`Mídia ${item.type} não encontrada em src/media/`);
    }
    return null;
  }

  infoLog(`Mídia: ${mediaFinder.describeMedia(filePath)}`);
  return buildMediaContent(item, filePath, buffer);
}

function formatDelayLabel(sec) {
  if (sec >= 60 && sec % 60 === 0) return `${sec / 60} min`;
  if (sec >= 60) return `${(sec / 60).toFixed(1)} min`;
  return `${sec}s`;
}

async function applySendDelays(short, opts = {}) {
  if (opts.noDelay) return;
  // Campanha manual: intervalo entre grupos é aplicado em broadcastToGroups (delayMs do wizard).
  if (opts.manualBlast || opts.forceBlast) return;

  const delayMs = operationalLimits.getInterGroupDelayMs({ forStatus: true });

  await floodGuard.beforeSend();
  if (delayMs > 0) {
    const minSec = Math.round(
      (cfg.INTER_GROUP_DELAY_MS_MIN ?? cfg.STATUS_DELAY_MIN ?? 60000) / 1000
    );
    const maxSec = Math.round(
      (cfg.INTER_GROUP_DELAY_MS_MAX ?? cfg.STATUS_DELAY_MAX ?? 300000) / 1000
    );
    const mode =
      cfg.STATUS_DELAY_ALTERNATE !== false ? 'alterna 1 min ↔ 5 min' : `${minSec}–${maxSec}s`;
    infoLog(
      `→ ${short}: próximo status em ~${formatDelayLabel(Math.round(delayMs / 1000))} (${mode})…`
    );
    await sleep(delayMs);
  }
}

function logAnnounceMemberHint(name, role) {
  if (!groupRole.isAnnounceOnlyMember(role)) return;
  if (!logThrottle.shouldLog(`announce-hint-${name}`, 30 * 60 * 1000)) return;
  warningLog(
    `${name}: grupo só-admins no chat · bot é membro — status no grupo exige admin no WhatsApp (promova o bot ou abra o GP a membros).`
  );
}

function failReasonForAnnounceMember(role, errMsg) {
  if (!groupRole.isAnnounceOnlyMember(role)) return errMsg;
  if (isTimeoutError(errMsg)) {
    return 'status indisponível — grupo só-admins e bot é membro (WhatsApp não concluiu o envio)';
  }
  return errMsg;
}

function extractMessageId(result) {
  if (!result) return null;
  if (typeof result === 'string') return result;
  return result.key?.id || result.messageId || null;
}

function isTransientUploadError(err) {
  const msg = String(err?.message || err || '');
  return /media upload failed|upload failed on all hosts|ECONNRESET|ETIMEDOUT|408|503|socket hang up/i.test(msg);
}

async function prepareGroupStatusPayload(sock, storyContent) {
  const upload = sock?.waUploadToServer;
  if (typeof upload !== 'function') {
    throw new Error('upload do WhatsApp indisponível — reconecte o bot');
  }
  const maxAttempts = Math.max(1, Math.min(4, Number(process.env.WA_MEDIA_UPLOAD_RETRIES) || 3));
  let lastErr;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const prepared = await generateWAMessageContent(storyContent, { upload });
      if (prepared?.message) {
        return { groupStatusMessage: { message: prepared.message } };
      }
      return { groupStatusMessage: storyContent };
    } catch (e) {
      lastErr = e;
      if (!isTransientUploadError(e) || attempt >= maxAttempts - 1) throw e;
      const waitMs = 1500 * (attempt + 1);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastErr || new Error('falha ao preparar mídia do status');
}

function mirrorToChatEnabled() {
  const env = String(process.env.STATUS_MIRROR_TO_CHAT || '').trim().toLowerCase();
  if (env === '0' || env === 'false' || env === 'off') return false;
  if (env === '1' || env === 'true' || env === 'on') return true;
  return cfg.STATUS_MIRROR_TO_CHAT !== false;
}

function chatMirrorGapMs() {
  const n = Number(process.env.STATUS_MIRROR_CHAT_GAP_MS ?? cfg.STATUS_MIRROR_CHAT_GAP_MS ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 30000) : 0;
}

function chatMirrorTimeoutMs() {
  return cfg.SEND_CHAT_MIRROR_TIMEOUT_MS ?? 60000;
}

async function buildChatPayload(storyContent, caption, opts = {}) {
  const cap = String(caption || '').trim();
  if (storyContent?.image) {
    return {
      image: storyContent.image,
      mimetype: storyContent.mimetype,
      caption: cap,
    };
  }
  if (storyContent?.video) {
    return {
      video: storyContent.video,
      mimetype: storyContent.mimetype,
      gifPlayback: Boolean(storyContent.gifPlayback),
      caption: cap,
    };
  }
  if (storyContent?.audio) {
    return { audio: storyContent.audio, mimetype: storyContent.mimetype };
  }
  if (cap) return { text: cap };

  const imagePath = opts.imagePath;
  if (imagePath && (await fs.pathExists(imagePath))) {
    const buffer = await fs.readFile(imagePath);
    return { image: buffer, caption: cap };
  }
  return null;
}

async function sendGroupChatMirror(sock, groupId, storyContent, caption, opts = {}) {
  if (!mirrorToChatEnabled()) {
    return { ok: false, skipped: true, reason: 'espelho chat desativado' };
  }

  const short = labels.shortId(groupId);
  const active = groupValidator.loadActiveGroups()[groupId] || {};
  const name = labels.displayName(active, short);
  const role = opts.role || (await groupRole.getBotRole(sock, groupId));

  if (groupRole.isAnnounceOnlyMember(role)) {
    return { ok: false, skipped: true, reason: 'só-admins — membro não posta no chat' };
  }

  const chatPayload = await buildChatPayload(storyContent, caption, opts);
  if (!chatPayload) {
    return { ok: false, skipped: true, reason: 'sem conteúdo para chat' };
  }

  const gapMs = chatMirrorGapMs();
  if (gapMs > 0) await sleep(gapMs);

  const tipo = chatPayload.image ? 'imagem' : chatPayload.video ? 'vídeo' : chatPayload.audio ? 'áudio' : 'texto';
  infoLog(`→ ${name}: espelhando no chat (${tipo}, ${groupRole.describeRole(role)})…`);

  try {
    await withTimeout(
      sock.sendMessage(groupId, chatPayload),
      chatMirrorTimeoutMs(),
      `chat ${short}`
    );
    successLog(`✓ Chat OK: ${name}`);
    return { ok: true };
  } catch (e) {
    warningLog(`✗ Chat espelho falhou (${name}): ${e.message}`);
    appendWaOpsEvent({
      kind: 'fail',
      target: name,
      detail: `espelho chat: ${e.message}`,
    });
    return { ok: false, reason: e.message };
  }
}

async function sendGroupStatus(sock, groupId, storyContent, opts = {}) {
  const short = labels.shortId(groupId);
  const name = labels.displayName(groupValidator.loadActiveGroups()[groupId], short);
  const role = opts.role || (await groupRole.getBotRole(sock, groupId));
  const announceMember = groupRole.isAnnounceOnlyMember(role);

  logAnnounceMemberHint(name, role);

  if (
    announceMember &&
    cfg.STATUS_BLOCK_ANNOUNCE_MEMBER !== false &&
    !opts.forceBlast
  ) {
    const err = new Error(
      'status bloqueado — grupo só-admins e bot é membro (promova o bot a admin para aparecer no grupo)'
    );
    err.announceMember = true;
    throw err;
  }

  await applySendDelays(short, opts);

  const timeout = sendTimeoutMs(announceMember);
  const roleTxt = groupRole.describeRole(role);
  const announceNote = announceMember ? ' · GP só-admins' : '';
  infoLog(`→ ${name}: enviando status (${roleTxt}${announceNote}, até ${Math.round(timeout / 1000)}s)…`);

  try {
    const payload = await prepareGroupStatusPayload(sock, storyContent);
    const result = await withTimeout(
      sock.sendMessage(groupId, payload),
      timeout,
      `status ${short}`
    );
    const msgId = extractMessageId(result);
    if (!msgId) {
      throw new Error('WhatsApp não confirmou o envio do status (sem ID de mensagem)');
    }
  } catch (e) {
    const msg = failReasonForAnnounceMember(role, e.message);
    const wrapped = new Error(msg);
    wrapped.cause = e;
    wrapped.announceMember = announceMember;
    throw wrapped;
  }

  antiBan.recordPost();
  floodGuard.afterSend();
  successLog(`✓ Status OK: ${name}`);
}

function resolveCaption(statusPayload, textFallback, opts = {}) {
  const fromPayload = String(statusPayload?.caption || '').trim();
  const fromFallback = String(textFallback || '').trim();
  const raw = fromFallback || fromPayload;
  const subscriberBlast =
    opts.skipCaptionSanitize ||
    opts.manualBlast ||
    opts.forceBlast ||
    opts.subscriberBlast ||
    opts.source === 'div-blast' ||
    opts.source === 'custom-blast' ||
    opts.campaign === 'div-blast' ||
    opts.campaign === 'custom-blast';
  if (subscriberBlast) return raw;
  const { sanitizeWaCaption } = require('../utils/statusCaptionSanitizer');
  return sanitizeWaCaption(raw, { productName: opts.productName });
}

function resolveChatMirrorCaption(statusCaption, opts = {}) {
  const { resolveChatCaption } = require('../utils/chatCaption');
  const chat = resolveChatCaption({
    chatText: opts.chatText,
    statusText: statusCaption,
    productId: opts.productId ?? null,
    productName: opts.productName ?? null,
  });
  return chat || statusCaption;
}

function buildStoryContent(statusPayload, caption) {
  if (!statusPayload) return buildTextStatus(caption);
  if (statusPayload.text !== undefined) return buildTextStatus(caption);

  const { text: _dropText, caption: _dropCaption, ...media } = statusPayload;
  if (!caption) return media;
  return { ...media, caption };
}

function statusPayloadHasMedia(statusPayload) {
  return Boolean(
    statusPayload &&
      statusPayload.text === undefined &&
      (statusPayload.image || statusPayload.video || statusPayload.audio)
  );
}

function buildStoryContentForPost(statusPayload, caption) {
  const mediaCap = Number(process.env.WA_STATUS_MEDIA_CAPTION_MAX) || 1024;
  const cap = String(caption || '').trim();
  if (statusPayloadHasMedia(statusPayload) && cap.length > mediaCap) {
    infoLog(
      `Status: texto (${cap.length} chars) > legenda mídia (${mediaCap}) — enviando status só texto (mensagem completa)`
    );
    return buildTextStatus(cap);
  }
  return buildStoryContent(statusPayload, cap);
}

function resolveImagePath(statusPayload, opts = {}) {
  if (opts.imagePath) return opts.imagePath;
  if (statusPayload?.imagePath) return statusPayload.imagePath;
  return null;
}

async function postToGroup(sock, groupId, statusPayload, textFallback, opts = {}) {
  const { skipGuard = false, startupFast = false } = opts;
  const short = labels.shortId(groupId);
  const active = groupValidator.loadActiveGroups()[groupId] || {};
  const name = labels.displayName(active, short);
  const caption = resolveCaption(statusPayload, textFallback, opts);

  if (!statusPayload && !caption) {
    return { ok: false, reason: 'sem conteúdo' };
  }

  if (!skipGuard && !opts.skipPostGuard && !opts.forceBlast) {
    const check = postGuard.canPostToGroup(groupId, {
      allowGraceBypass: Boolean(opts.allowGraceBypass || opts.hanorkPromo),
    });
    if (!check.ok) {
      appendWaOpsEvent({
        kind: 'skip',
        target: name,
        detail: check.reason,
      });
      const active = groupValidator.loadActiveGroups()[groupId] || {};
      const { shouldNotifyStatusBlocked } = require('../utils/manualJoinPolicy');
      if (shouldNotifyStatusBlocked(active) && !active.statusBlockedNotifiedAt) {
        try {
          require('../ipc/eventBus').emitStatusBlocked({
            group: name,
            reason: check.reason,
            manualJoin: Boolean(active.manualJoin),
            size: active.size || null,
          });
          groupValidator.registerGroup(groupId, {
            statusBlockedNotifiedAt: new Date().toISOString(),
          });
        } catch {
          /* IPC opcional */
        }
      }
      if (announceOnlyLeave.isAnnounceOnlyReason(check.reason)) {
        await announceOnlyLeave.handleFailure(sock, groupId, {
          name,
          source: opts.source || opts.campaign || 'auto',
        });
        return { ok: false, reason: check.reason, skipped: true, announceMember: true };
      }
      return { ok: false, reason: check.reason, skipped: true };
    }
  }

  const mediaType = statusPayload?.image
    ? 'image'
    : statusPayload?.video
      ? 'video'
      : statusPayload?.audio
        ? 'audio'
        : 'text';

  if (!opts.skipContentGuard) {
    try {
      const contentGuard = require('./statusContentGuard');
      const dup = contentGuard.checkBeforeSend({
        groupId,
        groupShort: short,
        caption,
        imagePath: resolveImagePath(statusPayload, opts),
        productId: opts.productId ?? null,
        mediaType,
        source: opts.source || opts.campaign || 'auto',
      });
      if (!dup.ok) {
        return { ok: false, reason: dup.reason, skipped: true, duplicate: true };
      }
      opts._statusHash = dup.hash;
    } catch {
      /* guard opcional */
    }
  }

  if (!opts.forceBlast && !opts.manualBlast && !antiBan.canPostNow(opts)) {
    const pause = risk.getPauseInfo();
    const reason = pause.hardPaused
      ? `anti-ban pausado (~${pause.remainingMin} min)`
      : 'cota horária';
    return { ok: false, reason };
  }

  const role = await groupRole.getBotRole(sock, groupId);
  if (
    !opts.forceBlast &&
    groupRole.isAnnounceOnlyMember(role) &&
    cfg.STATUS_BLOCK_ANNOUNCE_MEMBER !== false
  ) {
    await announceOnlyLeave.handleFailure(sock, groupId, {
      name,
      source: opts.source || opts.campaign || 'auto',
    });
    return {
      ok: false,
      reason: 'status bloqueado — grupo só-admins e bot é membro',
      skipped: true,
      announceMember: true,
    };
  }

  try {
    const content = buildStoryContentForPost(statusPayload, caption);
    if (!content) return { ok: false, reason: 'sem mídia para status' };

    await sendGroupStatus(sock, groupId, content, {
      startupFast,
      role,
      noDelay: opts.noDelay,
      forceBlast: opts.forceBlast,
      manualBlast: opts.manualBlast,
      delayMs: opts.delayMs,
    });
    try {
      require('./statusContentGuard').recordSuccessfulSend({
        hash: opts._statusHash,
        groupId,
        groupShort: short,
        caption,
        imagePath: resolveImagePath(statusPayload, opts),
        productId: opts.productId ?? null,
        mediaType,
        source: opts.source || opts.campaign || 'auto',
      });
    } catch {
      /* ignore */
    }

    let chatMirror = null;
    if (!opts.skipChatMirror && mirrorToChatEnabled()) {
      const chatCaption = resolveChatMirrorCaption(caption, opts);
      chatMirror = await sendGroupChatMirror(sock, groupId, content, chatCaption, {
        role,
        imagePath: resolveImagePath(statusPayload, opts),
        productId: opts.productId ?? null,
        productName: opts.productName ?? null,
        source: opts.source || opts.campaign || 'auto',
      });
    }

    announceOnlyLeave.resetStreak(groupId);
    return { ok: true, chatMirror: chatMirror?.ok === true };
  } catch (e) {
    const reason = e.message || 'falha no envio';
    const transient = /connection closed|connection was lost|stream errored|offline|ECONNRESET|408|timed out|tempo esgotado/i.test(
      reason
    );
    let online = true;
    try {
      online = require('./socketRegistry').isOnline();
    } catch {
      /* ignore */
    }
    if (!transient && online) {
      try {
        risk.recordSignal('post_fail', reason);
      } catch {
        /* ignore */
      }
    }
    if (!e.announceMember) {
      errorLog(`✗ Envio falhou (${name}): ${reason}`);
    }

    const skipTextRetry = e.announceMember || isTimeoutError(reason);

    // Anti-spam: se o grupo é só-admins e o bot é membro (não admin), não adianta insistir.
    // Marca inválido e sai (se auto-exit ligado) para não ficar falhando a cada ciclo.
    if (e.announceMember) {
      await announceOnlyLeave.handleFailure(sock, groupId, {
        name,
        source: opts.source || opts.campaign || 'custom-blast',
      });
      return { ok: false, reason: failReasonForAnnounceMember(role, reason), announceMember: true };
    }

    const allowTextFallback = process.env.STATUS_TEXT_FALLBACK === '1';
    if (allowTextFallback && caption && statusPayload && statusPayload.text === undefined && !skipTextRetry) {
      try {
        warningLog(`→ ${name}: tentando envio só com texto…`);
        await sendGroupStatus(sock, groupId, buildTextStatus(caption), { startupFast, role });
        return { ok: true, fallback: true };
      } catch (e2) {
        return { ok: false, reason: failReasonForAnnounceMember(role, e2.message) };
      }
    }

    if (groupRole.isAnnounceOnlyMember(role)) {
      warningLog(
        `${name}: em grupos só-admins, membros não postam no chat — o status também exige admin no WhatsApp. Solução: promover o bot a admin ou usar grupo aberto a membros.`
      );
    }

    return { ok: false, reason: failReasonForAnnounceMember(role, reason) };
  }
}

async function broadcastToGroups(sock, statusPayload, groupIds, onResult, textFallback, opts = {}) {
  if (!groupIds.length) return { sent: 0, failed: 0, skipped: 0 };

  const caption = resolveCaption(statusPayload, textFallback, {
    productName: opts.productName,
  });
  if (!statusPayload && !caption) {
    warningLog('Envio cancelado: sem mídia nem texto para status');
    return { sent: 0, failed: groupIds.length, skipped: 0 };
  }

  const tipo = statusPayload?.image
    ? 'imagem'
    : statusPayload?.video
      ? 'vídeo'
      : statusPayload?.audio
        ? 'áudio'
        : 'texto';

  infoLog(`Status [${tipo}] → ${groupIds.length} grupo(s)`);

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let paymentsSent = 0;
  const failSample = [];
  const skipSample = [];
  const skipReasons = {};

  const manualBlastLoop = Boolean(opts.manualBlast || opts.forceBlast);

  for (let i = 0; i < groupIds.length; i++) {
    const gid = groupIds[i];
    const gidLabel = labels.shortId(gid);

    if (manualBlastLoop && opts.jobId) {
      try {
        const blastCoordinator = require('./blastCoordinator');
        if (!blastCoordinator.tryClaimSharedBlastGroup(opts.jobId, gid)) {
          skipped += 1;
          const reason = 'outro bot WA (mesmo grupo)';
          skipReasons[reason] = (skipReasons[reason] || 0) + 1;
          continue;
        }
      } catch {
        /* ignore */
      }
    }

    if (
      require('./gracefulShutdownManager').isShuttingDown() ||
      !require('./socketRegistry').get()?.user
    ) {
      const connReason = 'conexão encerrada';
      if (manualBlastLoop) {
        const { waitForSocket } = require('./blastSendHelper');
        const recovered = await waitForSocket(120000);
        if (recovered?.user) {
          i -= 1;
          continue;
        }
        failed += 1;
        skipReasons[connReason] = (skipReasons[connReason] || 0) + 1;
        warningLog(`Blast: conexão não recuperada — falha em ${gidLabel}`);
        continue;
      }
      const remaining = groupIds.length - i;
      skipped += remaining;
      skipReasons[connReason] = (skipReasons[connReason] || 0) + remaining;
      warningLog(`Envio interrompido — ${connReason} (${remaining} restante(s))`);
      break;
    }

    const manualBypass =
      opts.manualBlast && (opts.bypassRiskPause || opts.forceBlast);
    if (!opts.forceBlast && !manualBypass && !antiBan.canPostNow(opts)) {
      const quotaReason = 'cota horária / anti-ban';
      if (manualBlastLoop) {
        skipped += 1;
        skipReasons[quotaReason] = (skipReasons[quotaReason] || 0) + 1;
        warningLog(`Blast: ${quotaReason} — pulando ${gidLabel}`);
        continue;
      }
      const remaining = groupIds.length - i;
      skipped += remaining;
      skipReasons[quotaReason] = (skipReasons[quotaReason] || 0) + remaining;
      const pause = risk.getPauseInfo();
      const isHanorkPromo = Boolean(opts.hanorkPromo && opts.bypassRiskPause);
      if (pause.hardPaused) {
        warningLog(
          isHanorkPromo
            ? `Anti-ban pausado (~${pause.remainingMin} min) — ${skipped} grupo(s) (promo Hanork deveria ignorar; verifique risco)`
            : `Anti-ban pausado (~${pause.remainingMin} min) — ${skipped} grupo(s); rotação automática respeita a pausa`
        );
        appendWaOpsEvent({
          kind: 'skip',
          detail: `anti-ban ~${pause.remainingMin} min — ${skipped} grupo(s)`,
          countermeasure: 'pausa anti-ban respeitada',
        });
      } else {
        warningLog(
          isHanorkPromo
            ? `Cota horária inesperada na promo Hanork — ${skipped} grupo(s)`
            : `Cota horária de posts — ${skipped} grupo(s) aguardam próximo ciclo`
        );
      }
      break;
    }
    let result = null;
    let postAttempt = 0;
    const maxPostAttempts = manualBlastLoop ? 5 : 1;
    let activeSock = require('./socketRegistry').get() || sock;
    while (postAttempt < maxPostAttempts) {
      activeSock = require('./socketRegistry').get() || sock;
      result = await postToGroup(activeSock, gid, statusPayload, caption, {
        startupFast: opts.startupFast,
        bypassRiskPause: opts.bypassRiskPause,
        allowGraceBypass: opts.allowGraceBypass,
        hanorkPromo: opts.hanorkPromo,
        skipPostGuard: opts.skipPostGuard,
        skipGuard: opts.skipGuard,
        skipContentGuard: opts.skipContentGuard,
        noDelay: opts.noDelay,
        forceBlast: opts.forceBlast,
        productId: opts.productId,
        productName: opts.productName,
        imagePath: opts.imagePath,
        source: opts.source,
        campaign: opts.campaign,
        chatText: opts.chatText,
        skipChatMirror: opts.skipChatMirror,
        manualBlast: opts.manualBlast,
        delayMs: opts.delayMs,
      });
      if (result.ok || result.skipped) break;
      const retryable = /conexão|connection|socket|timeout|estabilizando|relay|reset/i.test(
        String(result.reason || '')
      );
      if (!manualBlastLoop || !retryable || postAttempt >= maxPostAttempts - 1) break;
      postAttempt += 1;
      const { waitForSocket } = require('./blastSendHelper');
      await waitForSocket(30000);
    }

    if (result.ok) {
      sent++;
      if (opts.withPaymentAfterStatus) {
        try {
          const { sendPayment } = require('./groupPaymentPost');
          const { personalizeGroupText } = require('../utils/personalizeGroupText');
          const payBase = String(opts.paymentText || opts.chatText || caption || '').trim();
          if (payBase) {
            if (!opts._mentionCache) opts._mentionCache = new Map();
            const payText = await personalizeGroupText(activeSock, gid, payBase);
            await sendPayment(activeSock, gid, payText, opts._mentionCache);
            paymentsSent++;
          }
        } catch (e) {
          warningLog(`Pagamento pós-status falhou (${gidLabel}): ${e?.message || e}`);
        }
      }
    } else if (/cota horária|anti-ban pausado/i.test(String(result.reason || ''))) skipped++;
    else if (result.skipped) {
      skipped++;
      if (result.reason) {
        skipReasons[result.reason] = (skipReasons[result.reason] || 0) + 1;
      }
      if (skipSample.length < 3 && result.reason) {
        skipSample.push(`${labels.shortId(gid)}: ${result.reason}`);
      }
    }
    else {
      failed++;
      if (failSample.length < 3) {
        failSample.push(`${labels.shortId(gid)}: ${result.reason}`);
      }
      if (logThrottle.shouldLog(`wa-fail-${gid}`, 10 * 60 * 1000)) {
        appendWaOpsEvent({
          kind: 'fail',
          target: labels.shortId(gid),
          detail: result.reason || 'falha no envio',
        });
      }
    }

    if (onResult) onResult(gid, result.ok);

    if (manualBlastLoop && opts.jobId) {
      try {
        await require('./blastProgress').emitBlastProgress({
          jobId: opts.jobId,
          sent,
          failed,
          skipped,
          total: groupIds.length,
          index: i + 1,
          partial: true,
          campaign: opts.campaign || 'custom-blast',
        });
      } catch {
        /* ignore */
      }
    }

    const interGroupDelay =
      !opts.noDelay &&
      opts.manualBlast &&
      Number(opts.delayMs) > 0 &&
      i + 1 < groupIds.length;
    if (interGroupDelay) {
      const sec = Math.round(Number(opts.delayMs) / 1000);
      infoLog(`Blast: pausa ${sec}s antes do grupo ${i + 2}/${groupIds.length}`);
      await sleep(Number(opts.delayMs));
    } else if (
      !opts.noDelay &&
      !opts.manualBlast &&
      !opts.forceBlast &&
      (i + 1) % (cfg.BATCH_PAUSE_EVERY || 10) === 0 &&
      i + 1 < groupIds.length
    ) {
      const pause = cfg.BATCH_PAUSE_MS || 45000;
      infoLog(`Pausa entre lotes: ${Math.round(pause / 1000)}s`);
      await sleep(pause);
    }
  }

  if (sent > 0) {
    const payNote =
      paymentsSent > 0 ? ` + ${paymentsSent} pagamento(s) c/ menção` : '';
    successLog(
      `Status enviado em ${sent}/${groupIds.length} grupo(s)${payNote}${mirrorToChatEnabled() ? ' (+ chat espelhado)' : ''}`
    );
  } else {
    const detail = skipSample.length
      ? skipSample.join('; ')
      : failSample.length
        ? failSample.join('; ')
        : '';
    warningLog(
      `Nenhum status enviado (${groupIds.length} grupo(s))${detail ? ` — ${detail}` : ''}`
    );
  }

  if (failed > 0) {
    warningLog(
      `${failed} falha(s)${failSample.length ? `: ${failSample.join('; ')}` : ''}${failed > 3 ? '…' : ''}`
    );
  }

  if (opts.forceBlast && skipped > 0) {
    const top = Object.entries(skipReasons)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([reason, n]) => `${n}× ${reason}`)
      .join(' · ');
    infoLog(`Blast: ${skipped} grupo(s) pulado(s)${top ? ` — ${top}` : ''}`);
  }

  if (opts.forceBlast || opts.manualBlast) {
    const top = Object.entries(skipReasons)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([reason, n]) => `${n}× ${reason}`)
      .join(' · ');
    const summaryMsg = top ? `${sent}/${groupIds.length} · ${top}` : null;
    infoLog(`Blast resumo: ${sent}/${groupIds.length} enviados · ${failed} falha(s) · ${skipped} pulado(s)`);
    if (!opts.skipPostEvent) {
      try {
        require('../ipc/eventBus').emitPostCycle({
          sent,
          total: groupIds.length,
          failed,
          skipped,
          manual: opts.manual || opts.source === 'manual' || opts.manualBlast,
          campaign: opts.campaign,
          jobId: opts.jobId || null,
          message: summaryMsg,
        });
      } catch {
        /* IPC opcional */
      }
      return { sent, failed, skipped, skipReasons, paymentsSent };
    }
  }

  if (!opts.skipPostEvent) {
    try {
      require('../ipc/eventBus').emitPostCycle({
        sent,
        total: groupIds.length,
        failed,
        skipped,
        manual: opts.manual || opts.source === 'manual',
        campaign: opts.campaign,
        jobId: opts.jobId || null,
        paymentsSent,
      });
    } catch {
      /* IPC opcional */
    }
  }

  return { sent, failed, skipped, skipReasons, paymentsSent };
}

module.exports = {
  buildTextStatus,
  buildFromLocal,
  postToGroup,
  broadcastToGroups,
  sendGroupChatMirror,
  mirrorToChatEnabled,
  resolveMedia: mediaFinder.resolveMedia,
};
