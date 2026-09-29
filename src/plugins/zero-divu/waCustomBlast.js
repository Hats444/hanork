'use strict';

const { denyCbSilent } = require('../../utils/silencedAccess');

const fs = require('fs-extra');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { getZeroDivuClient } = require('./ZeroDivuClient');
const { listSpawnableSessions, resolveSession, isDualWaEnabled, DEFAULT_PRIMARY } = require('./waSessionsManifest');
const { mutateWa, replyWaText, offlineMessage } = require('./waIpcHelper');
const { toTwoCols } = require('../../telegram/menus/twoColKeyboard');

const sessions = new Map();
const SESSION_TTL_MS = 30 * 60 * 1000;

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function pruneSessions() {
  const now = Date.now();
  for (const [uid, s] of sessions.entries()) {
    if (now - (s.at || 0) > SESSION_TTL_MS) sessions.delete(uid);
  }
}

function getSession(uid) {
  pruneSessions();
  return sessions.get(uid) || null;
}

function setSession(uid, data) {
  sessions.set(uid, { ...data, at: Date.now() });
}

function clearSession(uid) {
  sessions.delete(uid);
}

function hasSession(uid) {
  return Boolean(getSession(uid));
}

function extractMedia(msg) {
  if (!msg) return null;
  if (msg.photo?.length) {
    const p = msg.photo[msg.photo.length - 1];
    return { fileId: p.file_id, kind: 'photo', ext: '.jpg' };
  }
  if (msg.video) {
    return { fileId: msg.video.file_id, kind: 'video', ext: '.mp4' };
  }
  if (msg.document) {
    const mime = String(msg.document.mime_type || '');
    if (/^image\//.test(mime)) {
      const ext = mime.includes('png') ? '.png' : mime.includes('webp') ? '.webp' : '.jpg';
      return { fileId: msg.document.file_id, kind: 'photo', ext };
    }
    if (/^video\//.test(mime)) {
      return { fileId: msg.document.file_id, kind: 'video', ext: '.mp4' };
    }
  }
  if (msg.animation) {
    return { fileId: msg.animation.file_id, kind: 'video', ext: '.mp4' };
  }
  return null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function getTelegramToken() {
  let token = process.env.TOKEN_TELEGRAM;
  if (!token) {
    try {
      token = require('../../config/config').TOKEN_TELEGRAM;
    } catch {
      /* ignore */
    }
  }
  return token || null;
}

function httpsGetBuffer(url, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { family: 4, timeout: timeoutMs }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        httpsGetBuffer(res.headers.location, timeoutMs).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`Download HTTP ${res.statusCode}`));
        return;
      }
      const chunks = [];
      let total = 0;
      res.on('data', (chunk) => {
        total += chunk.length;
        if (total > 16 * 1024 * 1024) {
          req.destroy(new Error('Arquivo grande demais (máx 16 MB)'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Download timeout')));
  });
}

async function downloadTelegramMedia(telegram, fileId) {
  let file;
  let getFileErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      file = await telegram.getFile(fileId);
      break;
    } catch (err) {
      getFileErr = err;
      if (attempt < 2) await sleep(800 * (attempt + 1));
    }
  }
  if (!file) throw getFileErr || new Error('Falha ao obter arquivo do Telegram');

  const remotePath = file?.file_path;
  if (!remotePath) throw new Error('Telegram não retornou file_path');

  const token = getTelegramToken();
  if (!token) throw new Error('TOKEN_TELEGRAM não configurado');

  const url = `https://api.telegram.org/file/bot${token}/${remotePath}`;
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await httpsGetBuffer(url);
    } catch (err) {
      lastErr = err;
      if (attempt < 2) await sleep(700 * (attempt + 1));
    }
  }
  throw lastErr;
}

async function stageToAllInboxes(buf, ext) {
  const stagingName = `custom-${Date.now()}${ext || '.jpg'}`;
  const names = [];
  for (const sessionId of listBlastTargetSessions()) {
    const client = getZeroDivuClient(sessionId);
    client.ensureDir();
    const inbox = path.join(client.ipcDir, 'inbox');
    fs.ensureDirSync(inbox);
    await fs.writeFile(path.join(inbox, stagingName), buf);
    names.push({ sessionId, stagingName });
  }
  return { stagingName, names };
}

async function copyStagingToAllInboxes(stagingName, sourceClient) {
  const src = path.join(sourceClient.ipcDir, 'inbox', path.basename(stagingName));
  if (!fs.existsSync(src)) return null;
  const buf = await fs.readFile(src);
  const ext = path.extname(stagingName) || '.jpg';
  return stageToAllInboxes(buf, ext);
}

function listBlastTargetSessions() {
  if (process.env.WA_BLAST_PRIMARY_ONLY === '1') {
    return [listSpawnableSessions()[0] || DEFAULT_PRIMARY];
  }
  if (isDualWaEnabled()) return listSpawnableSessions();
  return [listSpawnableSessions()[0] || DEFAULT_PRIMARY];
}

function previewText(session) {
  const text = escapeHtml(session.text || '(sem texto)');
  const media = session.mediaKind ? `\n📎 Mídia: <b>${session.mediaKind}</b>` : '\n📎 Só texto';
  const waLine = isDualWaEnabled()
    ? 'Dispara no <b>WA 1 + WA 2</b> — cada bot só nos grupos dele (sem duplicar no mesmo GP).'
    : 'Dispara no WhatsApp ativo.';
  return (
    '📢 <b>Blast personalizado — confirmar</b>\n\n' +
    `${waLine}\n` +
    '• Todos os grupos deste bot (1 post por GP)\n' +
    '• <b>Sem delay</b> entre grupos\n' +
    '• Ignora limite diário da divulgação automática\n' +
    '• Posta mesmo se já divulgou hoje\n\n' +
    `<b>Texto:</b>\n${text.slice(0, 1200)}${text.length > 1200 ? '…' : ''}` +
    media
  );
}

function confirmKeyboard(Markup) {
  return Markup.inlineKeyboard(
    toTwoCols([
      [{ text: '✅ Disparar agora', callback_data: 'a_wa_custom_blast_go' }],
      [
        { text: '❌ Cancelar', callback_data: 'a_wa_custom_blast_cancel' },
        { text: '🔙 Painel WA', callback_data: 'a_wa_menu' },
      ],
    ])
  );
}

function stepKeyboard(Markup) {
  return Markup.inlineKeyboard(
    toTwoCols([
      [
        { text: '❌ Cancelar', callback_data: 'a_wa_custom_blast_cancel' },
        { text: '🔙 Painel WA', callback_data: 'a_wa_menu' },
      ],
    ])
  );
}

function formatBlastError(err) {
  const nested = [];
  if (err?.name === 'AggregateError' && Array.isArray(err.errors)) {
    for (const e of err.errors) {
      nested.push(e?.code || e?.message || String(e));
    }
  }
  if (err?.cause) {
    nested.push(err.cause?.code || err.cause?.message || String(err.cause));
  }
  if (err?.errors?.length) {
    nested.push(...err.errors.map((e) => e?.message || e?.code || String(e)));
  }
  const code = err?.code || err?.cause?.code;
  if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return `Rede instável (${code}) — tente o blast de novo em instantes`;
  }
  const msg = String(err?.message || err || '').trim();
  if (nested.length) {
    const detail = nested.filter(Boolean).join(' · ');
    if (msg && msg !== 'AggregateError') return `${msg} (${detail})`;
    return detail || 'Falha de rede ao falar com o Telegram — tente de novo';
  }
  if (!msg || msg === 'AggregateError' || /failed, reason:\s*$/i.test(msg)) {
    return 'Falha de rede ao falar com o Telegram — tente de novo';
  }
  return msg;
}

async function stagePendingMedia(session, telegram) {
  if (!session?.pendingFileId) return session;
  const buf = await downloadTelegramMedia(telegram, session.pendingFileId);
  const staged = await stageToAllInboxes(buf, session.pendingExt || '.jpg');
  return {
    ...session,
    stagingName: staged.stagingName,
    pendingFileId: undefined,
    pendingExt: undefined,
  };
}

async function replyWaPanel(Msg, ctx, text, keyboard) {
  await Msg.editCallbackPanel(ctx, text, keyboard, { useMenuPhoto: true });
}

function capturePanelRef(ctx, fallback = null) {
  const msg = ctx.callbackQuery?.message || ctx.message;
  if (!msg?.message_id) return fallback;
  return {
    chatId: msg.chat?.id ?? ctx.chat?.id,
    messageId: msg.message_id,
    isPhoto: !!(msg.photo?.length),
    userId: ctx.from?.id,
  };
}

async function editBlastPanel(telegram, panelRef, text, keyboard) {
  if (!panelRef?.chatId || !telegram) return null;
  const { deliverAdminPanel } = require('../../telegram/broadcastNotify');
  const { unwrapReplyMarkup, pickTelegramOpts } = require('../../telegram/messageDelivery');
  const { getMenuPhotoInput } = require('../../telegram/menuPhoto');
  const rm = keyboard ? unwrapReplyMarkup(keyboard) : null;
  const tgOpts = pickTelegramOpts(rm?.inline_keyboard?.length ? { reply_markup: rm } : {});
  const photo = getMenuPhotoInput(panelRef.userId);
  const r = await deliverAdminPanel(telegram, panelRef, text, tgOpts, photo, { tryEdit: true });
  if (r?.messageId) {
    panelRef.messageId = r.messageId;
    panelRef.isPhoto = !!photo;
  }
  return r;
}

async function updateBlastPanel(Msg, ctx, panelRef, text, keyboard) {
  if (panelRef?.chatId && ctx?.telegram) {
    const r = await editBlastPanel(ctx.telegram, panelRef, text, keyboard);
    if (r?.ok) return panelRef;
  }
  if (ctx.callbackQuery) {
    await replyWaPanel(Msg, ctx, text, keyboard);
    return capturePanelRef(ctx, panelRef);
  }
  await Msg.replaceMenu(ctx, text, keyboard, { useMenuPhoto: true });
  return capturePanelRef(ctx, panelRef);
}

async function runBlastOnAllSessions(text, stagingName, adminId, blastId) {
  const jobRoot = blastId || crypto.randomBytes(4).toString('hex');
  const sessionIds = listBlastTargetSessions();

  const results = await Promise.all(
    sessionIds.map(async (sessionId) => {
      let label = sessionId;
      try {
        label = resolveSession(sessionId).displayName;
        const client = getZeroDivuClient(sessionId);
        const ack = await mutateWa(
          client,
          'wa.custom_blast',
          { text, stagingName, jobId: `${jobRoot}-${sessionId}`, force: true },
          adminId
        );
        const r = ack.result?.result || ack.result || {};
        return {
          sessionId,
          label,
          ok: ack.ok,
          error: ack.message || ack.error,
          started: r.started,
          total: r.total,
          jobId: r.jobId,
        };
      } catch (e) {
        return {
          sessionId,
          label,
          ok: false,
          error: formatBlastError(e),
        };
      }
    })
  );

  return results;
}

async function prepareBlastMedia(session, telegram) {
  if (session.stagingName) {
    const primary = getZeroDivuClient(listSpawnableSessions()[0]);
    const copied = await copyStagingToAllInboxes(session.stagingName, primary);
    if (!copied) {
      throw new Error('Mídia não encontrada no staging — reenvie foto/vídeo');
    }
    return copied;
  }
  if (session.pendingFileId) {
    const buf = await downloadTelegramMedia(telegram, session.pendingFileId);
    return stageToAllInboxes(buf, session.pendingExt || '.jpg');
  }
  return null;
}

function registerWaCustomBlast(bot, deps) {
  const { isAdmin, Msg, Markup, logger, deferBackground, waBlastTracker } = deps;
  const openingBlast = new Set();

  function guard(ctx) {
    if (!isAdmin(ctx.from?.id)) {
      denyCbSilent('admin_callback', ctx);
      return false;
    }
    if (ctx.chat?.type !== 'private') {
      ctx.answerCbQuery?.('Só no PV', { show_alert: true }).catch(() => {});
      return false;
    }
    return true;
  }

  bot.action('a_wa_custom_blast', async (ctx) => {
    if (!guard(ctx)) return;
    const uid = ctx.from.id;
    if (openingBlast.has(uid)) {
      await ctx.answerCbQuery('Aguarde…').catch(() => {});
      return;
    }
    await ctx.answerCbQuery().catch(() => {});
    openingBlast.add(uid);
    setSession(uid, { step: 'await_content', panelRef: capturePanelRef(ctx) });
    deferBackground('wa-blast-open', async () => {
      try {
        try {
          const promo = require('./waPromoPhotoUpload');
          if (promo.hasSession?.(uid)) promo.clearSession?.(uid);
        } catch {
          /* ignore */
        }
        const text =
          '📢 <b>Blast personalizado WhatsApp</b>\n\n' +
          'Envie <b>foto ou vídeo com legenda</b> (ou só texto).\n\n' +
          '• Posta em <b>todos</b> os grupos deste bot (1× por grupo)\n' +
          '• <b>Sem delay</b> · ignora limite diário automático\n' +
          (isDualWaEnabled()
            ? '• Com 2 WAs: dispara nos <b>dois</b> (cada um só nos grupos dele)\n'
            : '') +
          '\nUse os botões abaixo para voltar ou cancelar.';
        const session = getSession(uid);
        const panelRef = await updateBlastPanel(Msg, ctx, session?.panelRef, text, stepKeyboard(Markup));
        if (panelRef) setSession(uid, { ...getSession(uid), panelRef });
      } catch (err) {
        logger.error(`[WA custom blast] open: ${formatBlastError(err)}`);
        await replyWaText(
          Msg,
          ctx,
          `❌ Não abriu o blast: ${escapeHtml(formatBlastError(err))}`,
          stepKeyboard(Markup)
        ).catch(() => {});
      } finally {
        openingBlast.delete(uid);
      }
    });
  });

  bot.action('a_wa_custom_blast_cancel', async (ctx) => {
    if (!guard(ctx)) return;
    await ctx.answerCbQuery('Cancelado').catch(() => {});
    clearSession(ctx.from.id);
    await replyWaPanel(
      Msg,
      ctx,
      '❌ Blast personalizado cancelado.',
      Markup.inlineKeyboard([[{ text: '🔙 Painel WA', callback_data: 'a_wa_menu' }]])
    );
  });

  bot.action('a_wa_custom_blast_go', async (ctx) => {
    if (!guard(ctx)) return;
    const session = getSession(ctx.from.id);
    if (!session || session.step !== 'confirm') {
      await ctx.answerCbQuery('Sessão expirada', { show_alert: true }).catch(() => {});
      return;
    }
    await ctx.answerCbQuery('Disparando…').catch(() => {});

    const blastId = crypto.randomBytes(4).toString('hex');
    const panelMsg = ctx.callbackQuery?.message;
    const panelRef = {
      chatId: panelMsg?.chat?.id ?? ctx.chat?.id,
      messageId: panelMsg?.message_id,
      isPhoto: !!(panelMsg?.photo?.length),
      userId: ctx.from?.id,
    };
    const expectedSessions = listBlastTargetSessions().map((sessionId) => ({
      sessionId,
      label: resolveSession(sessionId).displayName,
    }));

    const sessionCopy = { ...session };
    const blastText = String(session.text || '').trim();
    const adminId = ctx.from.id;
    const telegram = ctx.telegram;
    const correlationId = ctx.state?.correlationId;

    clearSession(adminId);

    if (waBlastTracker) {
      waBlastTracker.register(blastId, {
        adminId,
        panelRef,
        expectedSessions,
        textPreview: blastText.slice(0, 200),
        mediaKind: sessionCopy.mediaKind || null,
        startedAt: Date.now(),
      });
    }

    await replyWaPanel(
      Msg,
      ctx,
      '⏳ <b>Preparando blast personalizado…</b>\n\n<i>Baixando mídia e enfileirando nos workers WhatsApp.</i>',
      Markup.inlineKeyboard([[{ text: '🔙 Painel WA', callback_data: 'a_wa_menu' }]])
    ).catch(() => {});

    deferBackground('wa-custom-blast', async () => {
      let stagingName = sessionCopy.stagingName || null;
      try {
        const staged = await prepareBlastMedia(sessionCopy, telegram);
        if (staged?.stagingName) stagingName = staged.stagingName;
      } catch (err) {
        logger.error(`[WA custom blast] ${formatBlastError(err)}`, { correlationId });
        if (waBlastTracker) {
          await waBlastTracker
            .notifyError(panelRef, adminId, escapeHtml(formatBlastError(err)), Markup)
            .catch(() => {});
        } else {
          await editBlastPanel(
            telegram,
            panelRef,
            `❌ Blast falhou: ${escapeHtml(formatBlastError(err))}`,
            Markup.inlineKeyboard([[{ text: '🔙 Painel WA', callback_data: 'a_wa_menu' }]])
          ).catch(() => {});
        }
        return;
      }

      try {
        const results = await runBlastOnAllSessions(
          blastText,
          stagingName,
          adminId,
          blastId
        );

        if (waBlastTracker) {
          for (const r of results) {
            if (!r.ok) {
              waBlastTracker.markFailedStart(blastId, r.sessionId, r.error || 'falha ao enfileirar');
            }
          }
          const watchJobs = results
            .filter((r) => r.ok && r.jobId)
            .map((r) => ({ sessionId: r.sessionId, jobId: r.jobId }));
          if (watchJobs.length) {
            waBlastTracker.startJobWatch(blastId, watchJobs);
          }
          try {
            await waBlastTracker.refreshPanel(blastId);
          } catch (panelErr) {
            logger.warn(`[WA custom blast] painel: ${formatBlastError(panelErr)}`, { correlationId });
          }
          return;
        }

        const lines = results.map((r) => {
          if (!r.ok) return `❌ ${r.label}: ${escapeHtml(r.error || 'falha')}`;
          return `✅ ${r.label}: iniciado · ~${r.total ?? '?'} grupo(s) · job <code>${r.jobId || '?'}</code>`;
        });
        await telegram
          .sendMessage(
            adminId,
            '🚀 <b>Blast personalizado enfileirado</b>\n\n' +
              lines.join('\n') +
              '\n\n<i>Resultado final nos logs WA quando terminar.</i>',
            {
              parse_mode: 'HTML',
              ...Markup.inlineKeyboard([[{ text: '🔙 Painel WA', callback_data: 'a_wa_menu' }]]),
            }
          )
          .catch(() => {});
      } catch (err) {
        logger.error(`[WA custom blast] ${formatBlastError(err)}`, { correlationId });
        if (waBlastTracker) {
          await waBlastTracker
            .notifyError(panelRef, adminId, escapeHtml(formatBlastError(err)), Markup)
            .catch(() => {});
          return;
        }
        await telegram
          .sendMessage(adminId, `❌ Blast falhou: ${escapeHtml(formatBlastError(err))}`, {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([[{ text: '🔙 Painel WA', callback_data: 'a_wa_menu' }]]),
          })
          .catch(() => {});
      }
    });
  });

  bot.command('wa_blast', async (ctx) => {
    if (!isAdmin(ctx.from?.id) || ctx.chat?.type !== 'private') return;
    try {
      const promo = require('./waPromoPhotoUpload');
      if (promo.hasSession?.(ctx.from.id)) promo.clearSession?.(ctx.from.id);
    } catch {
      /* ignore */
    }
    setSession(ctx.from.id, { step: 'await_content' });
    await replyWaText(
      Msg,
      ctx,
      '📢 Modo blast WA ativo — envie mídia + legenda ou texto.',
      stepKeyboard(Markup)
    );
  });

  async function handleText(ctx, txt) {
    if (!isAdmin(ctx.from?.id) || ctx.chat?.type !== 'private') return false;
    const session = getSession(ctx.from.id);
    if (!session) return false;

    const cancelCmd =
      txt === '/cancelar' || txt === '/cancel' || txt.toLowerCase() === '/cancelar';
    if (cancelCmd) {
      clearSession(ctx.from.id);
      await replyWaText(
        Msg,
        ctx,
        '❌ Blast personalizado cancelado.',
        Markup.inlineKeyboard([[{ text: '🔙 Painel WA', callback_data: 'a_wa_menu' }]])
      );
      return true;
    }

    if (session.step === 'await_content') {
      const text = String(txt || '').trim();
      if (!text) {
        const panelRef = await updateBlastPanel(
          Msg,
          ctx,
          session.panelRef,
          '⚠️ Envie um texto ou foto com legenda.',
          stepKeyboard(Markup)
        );
        if (panelRef) setSession(ctx.from.id, { ...session, panelRef });
        return true;
      }
      const panelRef = session.panelRef;
      setSession(ctx.from.id, { step: 'confirm', text, panelRef });
      const nextPanel = await updateBlastPanel(
        Msg,
        ctx,
        panelRef,
        previewText(getSession(ctx.from.id)),
        confirmKeyboard(Markup)
      );
      if (nextPanel) setSession(ctx.from.id, { ...getSession(ctx.from.id), panelRef: nextPanel });
      return true;
    }

    if (session.step === 'await_text') {
      const text = String(txt || '').trim();
      if (!text) {
        const panelRef = await updateBlastPanel(
          Msg,
          ctx,
          session.panelRef,
          '⚠️ Envie o texto da divulgação.',
          stepKeyboard(Markup)
        );
        if (panelRef) setSession(ctx.from.id, { ...session, panelRef });
        return true;
      }
      try {
        const staged = await stagePendingMedia({ ...session, text }, ctx.telegram);
        setSession(ctx.from.id, { ...staged, step: 'confirm', text, panelRef: session.panelRef });
      } catch (err) {
        const panelRef = await updateBlastPanel(
          Msg,
          ctx,
          session.panelRef,
          `❌ Não consegui baixar a mídia: ${escapeHtml(formatBlastError(err))}\n\nReenvie foto/vídeo.`,
          stepKeyboard(Markup)
        );
        if (panelRef) setSession(ctx.from.id, { ...session, panelRef });
        return true;
      }
      const nextPanel = await updateBlastPanel(
        Msg,
        ctx,
        session.panelRef,
        previewText(getSession(ctx.from.id)),
        confirmKeyboard(Markup)
      );
      if (nextPanel) setSession(ctx.from.id, { ...getSession(ctx.from.id), panelRef: nextPanel });
      return true;
    }

    return false;
  }

  async function handleMedia(ctx) {
    if (!isAdmin(ctx.from?.id) || ctx.chat?.type !== 'private') return false;
    const session = getSession(ctx.from.id);
    if (!session || (session.step !== 'await_content' && session.step !== 'await_text')) return false;

    const media = extractMedia(ctx.message);
    if (!media) {
      await replyWaText(Msg, ctx, '⚠️ Envie foto, vídeo ou imagem em documento.', stepKeyboard(Markup));
      return true;
    }

    const caption = String(ctx.message.caption || '').trim();
    if (!caption && session.step === 'await_content') {
      setSession(ctx.from.id, {
        step: 'await_text',
        pendingFileId: media.fileId,
        pendingExt: media.ext,
        mediaKind: media.kind,
        panelRef: session.panelRef,
      });
      const panelRef = await updateBlastPanel(
        Msg,
        ctx,
        session.panelRef,
        '📝 Mídia recebida. Agora envie o <b>texto</b> da divulgação.',
        stepKeyboard(Markup)
      );
      if (panelRef) setSession(ctx.from.id, { ...getSession(ctx.from.id), panelRef });
      return true;
    }

    setSession(ctx.from.id, {
      step: 'confirm',
      text: caption || session.text || '',
      pendingFileId: media.fileId,
      pendingExt: media.ext,
      mediaKind: media.kind,
      panelRef: session.panelRef,
    });

    try {
      const staged = await stagePendingMedia(getSession(ctx.from.id), ctx.telegram);
      setSession(ctx.from.id, { ...staged, step: 'confirm', panelRef: session.panelRef });
    } catch (err) {
      const panelRef = await updateBlastPanel(
        Msg,
        ctx,
        session.panelRef,
        `❌ Não consegui baixar a mídia: ${escapeHtml(formatBlastError(err))}\n\nReenvie foto/vídeo.`,
        stepKeyboard(Markup)
      );
      if (panelRef) setSession(ctx.from.id, { ...session, panelRef });
      return true;
    }

    const nextPanel = await updateBlastPanel(
      Msg,
      ctx,
      session.panelRef,
      previewText(getSession(ctx.from.id)),
      confirmKeyboard(Markup)
    );
    if (nextPanel) setSession(ctx.from.id, { ...getSession(ctx.from.id), panelRef: nextPanel });
    return true;
  }

  bot.use(async (ctx, next) => {
    const uid = ctx.from?.id;
    if (!uid || !isAdmin(uid) || ctx.chat?.type !== 'private') return next();
    if (!hasSession(uid)) return next();

    const msg = ctx.message;
    if (!msg) return next();

    if (msg.text) {
      if (msg.text.startsWith('/')) return next();
      const handled = await handleText(ctx, msg.text);
      if (handled) return;
    }

    if (msg.photo || msg.video || msg.document || msg.animation) {
      const handled = await handleMedia(ctx);
      if (handled) return;
    }

    return next();
  });

  logger.info('Blast personalizado WA registrado (a_wa_custom_blast, /wa_blast)', {
    category: 'HANORK',
    module: 'WA',
  });

  return { handleText, handleMedia, hasSession, clearSession };
}

module.exports = { registerWaCustomBlast, hasSession: (uid) => hasSession(uid) };
