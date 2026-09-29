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

async function applySendDelays(short) {
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

async function prepareGroupStatusPayload(sock, storyContent) {
  const upload = sock?.waUploadToServer;
  if (typeof upload !== 'function') {
    throw new Error('upload do WhatsApp indisponível — reconecte o bot');
  }
  const prepared = await generateWAMessageContent(storyContent, { upload });
  if (prepared?.message) {
    return { groupStatusMessage: { message: prepared.message } };
  }
  return { groupStatusMessage: storyContent };
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

  if (announceMember && cfg.STATUS_BLOCK_ANNOUNCE_MEMBER !== false) {
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
  const { sanitizeWaCaption } = require('../utils/statusCaptionSanitizer');
  const fromPayload = String(statusPayload?.caption || '').trim();
  const fromFallback = String(textFallback || '').trim();
  const raw = fromFallback || fromPayload;
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

  if (!skipGuard && !opts.skipPostGuard) {
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

  if (!antiBan.canPostNow(opts)) {
    const pause = risk.getPauseInfo();
    const reason = pause.hardPaused
      ? `anti-ban pausado (~${pause.remainingMin} min)`
      : 'cota horária';
    return { ok: false, reason };
  }

  const role = await groupRole.getBotRole(sock, groupId);
  if (groupRole.isAnnounceOnlyMember(role) && cfg.STATUS_BLOCK_ANNOUNCE_MEMBER !== false) {
    return {
      ok: false,
      reason: 'status bloqueado — grupo só-admins e bot é membro',
      skipped: true,
      announceMember: true,
    };
  }

  try {
    const content = buildStoryContent(statusPayload, caption);
    if (!content) return { ok: false, reason: 'sem mídia para status' };
    await sendGroupStatus(sock, groupId, content, { startupFast, role });
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
    if (mirrorToChatEnabled()) {
      const chatCaption = resolveChatMirrorCaption(caption, opts);
      chatMirror = await sendGroupChatMirror(sock, groupId, content, chatCaption, {
        role,
        imagePath: resolveImagePath(statusPayload, opts),
        productId: opts.productId ?? null,
        productName: opts.productName ?? null,
        source: opts.source || opts.campaign || 'auto',
      });
    }

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
      const active = groupValidator.loadActiveGroups()[groupId] || {};
      const failCount = (active.statusFailCount || 0) + 1;
      try {
        groupValidator.registerGroup(groupId, {
          postPermission: 'denied',
          statusBlockedReason: 'só-admins (membro)',
          statusFailCount: failCount,
          lastStatusFailAt: new Date().toISOString(),
        });
      } catch {
        /* ignore */
      }
      const autoLeaveAnnounce =
        cfg.STATUS_AUTO_LEAVE_ON_ANNOUNCE_ONLY !== false &&
        cfg.ENABLE_AUTO_EXIT !== false &&
        failCount >= (cfg.STATUS_LEAVE_AFTER_FAILS ?? 2) &&
        !active.manualJoin;
      if (autoLeaveAnnounce) {
        try {
          const groupBanGuard = require('./groupBanGuard');
          await sleep(1500);
          const out = await groupBanGuard.safeLeaveGroup(
            sock,
            groupId,
            'só-admins (bot não é admin) — status bloqueado',
            { bypassBanGuard: true, policyCheck: async () => true }
          );
          if (out.left) {
            warningLog(`${name}: removido após ${failCount} falha(s) em só-admins`);
            try {
              require('../ipc/eventBus').emitLeave({
                group: name,
                reason: 'só-admins — status bloqueado (auto-saída)',
              });
            } catch {
              /* IPC opcional */
            }
            appendWaOpsEvent({
              kind: 'countermeasure',
              target: name,
              detail: 'só-admins — status bloqueado',
              countermeasure: 'auto-saída do grupo',
            });
          }
        } catch {
          /* ignore */
        }
      } else {
        warningLog(`${name}: status bloqueado (só-admins) — grupo mantido`);
        appendWaOpsEvent({
          kind: 'skip',
          target: name,
          detail: 'só-admins — membro sem postar status',
        });
        if (failCount === 1 || active.manualJoin) {
          try {
            require('../ipc/eventBus').emitStatusBlocked({
              group: name,
              reason: 'só-admins — promova o bot a admin ou use grupo aberto a membros',
              manualJoin: Boolean(active.manualJoin),
              size: active.size || null,
            });
          } catch {
            /* IPC opcional */
          }
        }
      }
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
  const failSample = [];
  const skipSample = [];

  for (let i = 0; i < groupIds.length; i++) {
    if (
      require('./gracefulShutdownManager').isShuttingDown() ||
      !require('./socketRegistry').get()?.user
    ) {
      skipped += groupIds.length - i;
      warningLog(`Envio interrompido — conexão encerrada (${skipped} restante(s))`);
      break;
    }

    if (!antiBan.canPostNow(opts)) {
      skipped += groupIds.length - i;
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

    const gid = groupIds[i];
    const result = await postToGroup(sock, gid, statusPayload, caption, {
      startupFast: opts.startupFast,
      bypassRiskPause: opts.bypassRiskPause,
      allowGraceBypass: opts.allowGraceBypass,
      hanorkPromo: opts.hanorkPromo,
      skipPostGuard: opts.skipPostGuard,
      productId: opts.productId,
      productName: opts.productName,
      imagePath: opts.imagePath,
      source: opts.source,
      campaign: opts.campaign,
      chatText: opts.chatText,
    });

    if (result.ok) sent++;
    else if (/cota horária|anti-ban pausado/i.test(String(result.reason || ''))) skipped++;
    else if (result.skipped) {
      skipped++;
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

    if ((i + 1) % (cfg.BATCH_PAUSE_EVERY || 10) === 0 && i + 1 < groupIds.length) {
      const pause = cfg.BATCH_PAUSE_MS || 45000;
      infoLog(`Pausa entre lotes: ${Math.round(pause / 1000)}s`);
      await sleep(pause);
    }
  }

  if (sent > 0) {
    successLog(`Status enviado em ${sent}/${groupIds.length} grupo(s)${mirrorToChatEnabled() ? ' (+ chat espelhado)' : ''}`);
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

  try {
    require('../ipc/eventBus').emitPostCycle({
      sent,
      total: groupIds.length,
      failed,
      skipped,
      manual: opts.manual || opts.source === 'manual',
      campaign: opts.campaign,
    });
  } catch {
    /* IPC opcional */
  }

  return { sent, failed, skipped };
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
