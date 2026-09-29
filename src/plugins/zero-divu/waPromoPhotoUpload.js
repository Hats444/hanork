'use strict';

const { denyCbSilent } = require('../../utils/silencedAccess');

const axios = require('axios');
const {
  PROMO_TYPES,
  savePromoPhoto,
  parseSlotFromCaption,
  findNextEmptySlot,
  normalizeSlot,
  themeFileNameForSlot,
  formatStatusText,
  reloadWaAfterUpload,
} = require('../../services/promoPhotoUploadService');
const { replyWaText } = require('./waIpcHelper');
const { toTwoCols } = require('../../telegram/menus/twoColKeyboard');

const sessions = new Map();
const TTL_MS = 20 * 60 * 1000;

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function prune() {
  const now = Date.now();
  for (const [uid, s] of sessions.entries()) {
    if (now - (s.at || 0) > TTL_MS) sessions.delete(uid);
  }
}

function setSession(uid, data) {
  sessions.set(uid, { ...data, at: Date.now() });
}

function getSession(uid) {
  prune();
  return sessions.get(uid) || null;
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
    return { fileId: p.file_id, mimeType: 'image/jpeg', ext: '.jpg' };
  }
  if (msg.document) {
    const mime = String(msg.document.mime_type || '');
    if (!/^image\//.test(mime)) return null;
    const ext = mime.includes('png') ? '.png' : mime.includes('webp') ? '.webp' : '.jpg';
    return { fileId: msg.document.file_id, mimeType: mime, ext };
  }
  return null;
}

async function downloadMedia(ctx, fileId) {
  const link = await ctx.telegram.getFileLink(fileId);
  const res = await axios.get(link.href, {
    responseType: 'arraybuffer',
    maxContentLength: 12 * 1024 * 1024,
    timeout: 90000,
  });
  return Buffer.from(res.data);
}

function uploadStepKeyboard(Markup) {
  return Markup.inlineKeyboard(
    toTwoCols([
      [
        { text: '❌ Cancelar', callback_data: 'a_foto_promo_cancel' },
        { text: '🔙 Fotos', callback_data: 'a_foto_promo_menu' },
      ],
      [{ text: '📱 Painel WA', callback_data: 'a_wa_menu' }],
    ])
  );
}

function divulgacaoHelpText() {
  return (
    '🖼 <b>Divulgação — Hanork · SMM · Números SMS</b>\n\n' +
    '<b>O que roda hoje</b>\n' +
    '• <b>25 textos</b> detalhados por tipo (JSON, sem os ~200 MD antigos)\n' +
    '• <b>1 foto principal</b> por tipo (slot 1) — todos os textos usam a mesma imagem\n' +
    '• Rotação automática no Telegram e WhatsApp Status\n\n' +
    '<b>Tipos</b>\n' +
    '🛍 <b>Hanork PRO</b> — loja automática, checkout PIX/MP\n' +
    '📈 <b>SMM / SSM</b> — seguidores, curtidas, views\n' +
    '📱 <b>Números SMS</b> — Virtuo, números fake para verificação\n\n' +
    '<b>Comandos (PV admin)</b>\n' +
    '<code>/foto_hanork</code> — enviar foto Hanork\n' +
    '<code>/foto_smm</code> — enviar foto SMM\n' +
    '<code>/foto_numeros</code> — enviar foto Números\n' +
    '<code>/fotos_divulgacao</code> — status das fotos'
  );
}

function typeKeyboard(Markup, backCallback = 'a_wa_menu') {
  const backLabel = backCallback === 'a_menu_p0' ? '🔙 Admin' : '🔙 WhatsApp';
  return Markup.inlineKeyboard(
    toTwoCols([
      [
        { text: '🛍 Foto Hanork', callback_data: 'a_foto_promo_hanork' },
        { text: '📈 Foto SMM', callback_data: 'a_foto_promo_smm' },
      ],
      [
        { text: '📱 Foto Números', callback_data: 'a_foto_promo_virtuo' },
        { text: '📋 Status', callback_data: 'a_foto_promo_status' },
      ],
      [{ text: backLabel, callback_data: backCallback }],
    ])
  );
}

function registerWaPromoPhotoUpload(bot, deps) {
  const { isAdmin, Msg, Markup, logger, deferBackground, editAdminPanel } = deps;

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

  function clearOtherWaSessions(uid) {
    try {
      const blast = require('./waCustomBlast');
      if (blast.hasSession?.(uid)) blast.clearSession?.(uid);
    } catch {
      /* ignore */
    }
  }

  function resolveSlot(type, rawSlot) {
    if (rawSlot == null || rawSlot === '') {
      return findNextEmptySlot(type);
    }
    const norm = normalizeSlot(rawSlot, type);
    return norm?.slot ?? null;
  }

  function startUpload(ctx, type, slot = null) {
    const meta = PROMO_TYPES[type];
    const resolved = resolveSlot(type, slot);
    if (!resolved) {
      return replyWaText(
        Msg,
        ctx,
        '⚠️ Slot inválido. Use <code>/foto_hanork</code> (foto principal slot 1).'
      );
    }
    clearOtherWaSessions(ctx.from.id);
    setSession(ctx.from.id, { type, slot: resolved });
    const fileName = themeFileNameForSlot(type, resolved);
    return replyWaText(
      Msg,
      ctx,
        `🖼 <b>Foto ${meta.label}</b>\n\n` +
        `Envie a imagem agora (foto ou documento).\n` +
        `Será salva como foto principal → <code>${fileName}</code>\n\n` +
        `<i>25 textos usam esta mesma imagem na divulgação.</i>`,
      uploadStepKeyboard(Markup)
    );
  }

  bot.action('a_foto_promo_cancel', async (ctx) => {
    if (!guard(ctx)) return;
    await ctx.answerCbQuery('Cancelado').catch(() => {});
    clearSession(ctx.from.id);
    await replyWaText(
      Msg,
      ctx,
      '❌ Upload de foto cancelado.',
      typeKeyboard(Markup)
    );
  });

  bot.action('a_foto_promo_menu', async (ctx) => {
    if (!guard(ctx)) return;
    await ctx.answerCbQuery().catch(() => {});
    const text = divulgacaoHelpText();
    if (editAdminPanel && ctx.callbackQuery) {
      await editAdminPanel(ctx, text, typeKeyboard(Markup, 'a_wa_menu'));
    } else {
      await replyWaText(Msg, ctx, text, typeKeyboard(Markup, 'a_wa_menu'));
    }
  });

  bot.action('a_divulgacao_menu', async (ctx) => {
    if (!guard(ctx)) return;
    await ctx.answerCbQuery().catch(() => {});
    const text = divulgacaoHelpText();
    if (editAdminPanel && ctx.callbackQuery) {
      await editAdminPanel(ctx, text, typeKeyboard(Markup, 'a_menu_p0'));
    } else {
      await replyWaText(Msg, ctx, text, typeKeyboard(Markup, 'a_menu_p0'));
    }
  });

  bot.action('a_foto_promo_hanork', async (ctx) => {
    if (!guard(ctx)) return;
    await ctx.answerCbQuery().catch(() => {});
    await startUpload(ctx, 'hanork');
  });

  bot.action('a_foto_promo_smm', async (ctx) => {
    if (!guard(ctx)) return;
    await ctx.answerCbQuery().catch(() => {});
    await startUpload(ctx, 'smm');
  });

  bot.action('a_foto_promo_virtuo', async (ctx) => {
    if (!guard(ctx)) return;
    await ctx.answerCbQuery().catch(() => {});
    await startUpload(ctx, 'virtuo');
  });

  bot.action('a_foto_promo_status', async (ctx) => {
    if (!guard(ctx)) return;
    await ctx.answerCbQuery().catch(() => {});
    await replyWaText(Msg, ctx, formatStatusText(), typeKeyboard(Markup, 'a_divulgacao_menu'));
  });

  bot.command('foto_hanork', async (ctx) => {
    if (!isAdmin(ctx.from?.id) || ctx.chat?.type !== 'private') return;
    const parts = (ctx.message?.text || '').trim().split(/\s+/);
    const slot = parts.length > 1 ? parts[1] : null;
    await startUpload(ctx, 'hanork', slot);
  });

  bot.command('foto_smm', async (ctx) => {
    if (!isAdmin(ctx.from?.id) || ctx.chat?.type !== 'private') return;
    const parts = (ctx.message?.text || '').trim().split(/\s+/);
    const slot = parts.length > 1 ? parts[1] : null;
    await startUpload(ctx, 'smm', slot);
  });

  bot.command('foto_numeros', async (ctx) => {
    if (!isAdmin(ctx.from?.id) || ctx.chat?.type !== 'private') return;
    await startUpload(ctx, 'virtuo');
  });

  bot.command('foto_virtuo', async (ctx) => {
    if (!isAdmin(ctx.from?.id) || ctx.chat?.type !== 'private') return;
    await startUpload(ctx, 'virtuo');
  });

  bot.command('fotos_divulgacao', async (ctx) => {
    if (!isAdmin(ctx.from?.id) || ctx.chat?.type !== 'private') return;
    await replyWaText(Msg, ctx, formatStatusText(), typeKeyboard(Markup));
  });

  async function processUpload(ctx, session, media) {
    const captionSlot = parseSlotFromCaption(ctx.message?.caption);
    const rawSlot = captionSlot ?? session.slot ?? findNextEmptySlot(session.type);
    const norm = normalizeSlot(rawSlot, session.type);
    if (!norm) {
      await replyWaText(Msg, ctx, '⚠️ Slot inválido na legenda. Use slot 1 (foto principal).');
      return;
    }
    const slot = norm.slot;

    deferBackground(`promo-photo-${session.type}`, async () => {
      try {
        await Msg.reply(ctx, '⏳ Salvando foto…');
        const buf = await downloadMedia(ctx, media.fileId);
        const result = savePromoPhoto(session.type, buf, { slot });

        if (!result.ok) {
          await replyWaText(Msg, ctx, `❌ ${escapeHtml(result.message || result.error)}`);
          return;
        }

        clearSession(ctx.from.id);
        const wa = await reloadWaAfterUpload(session.type);

        await replyWaText(
          Msg,
          ctx,
          `✅ <b>Foto ${result.label} salva</b>\n\n` +
            `Slot: <b>${result.slot}</b>\n` +
            `Arquivo: <code>${result.fileName}</code>\n` +
            `${result.replaced ? '🔄 Substituiu foto anterior neste slot\n' : ''}` +
            `${result.warn ? `⚠️ ${escapeHtml(result.warn)}\n` : ''}` +
            `Pastas: <b>${result.paths.length}</b> (${result.type === 'hanork' ? 'Hanork' : 'SMM'})\n` +
            `WA: ${wa.map((w) => (w.ok ? `✅ ${w.sessionId}` : `⚠️ ${w.sessionId || w.error}`)).join(' · ') || '—'}\n\n` +
            `<i>Já entra na rotação de divulgação automaticamente.</i>`,
          typeKeyboard(Markup)
        );
      } catch (err) {
        logger.error(`[promo-photo] ${err?.message || err}`);
        await replyWaText(Msg, ctx, `❌ Erro: ${escapeHtml(err?.message || 'falha ao salvar')}`);
      }
    });
  }

  async function handleText(ctx, txt) {
    if (!isAdmin(ctx.from?.id) || ctx.chat?.type !== 'private') return false;
    const session = getSession(ctx.from.id);
    if (!session) return false;

    const cancel =
      txt === '/cancelar' || txt === '/cancel' || txt.toLowerCase() === '/cancelar';
    if (cancel) {
      clearSession(ctx.from.id);
      await replyWaText(Msg, ctx, '❌ Upload de foto cancelado.', typeKeyboard(Markup));
      return true;
    }

    const slot = parseSlotFromCaption(txt);
    if (slot != null) {
      const norm = normalizeSlot(slot, session.type);
      if (!norm) {
        await replyWaText(Msg, ctx, '⚠️ Slot inválido. Use 1–20.', uploadStepKeyboard(Markup));
        return true;
      }
      setSession(ctx.from.id, { ...session, slot: norm.slot });
      await replyWaText(
        Msg,
        ctx,
        `✅ Slot <b>${norm.slot}</b> → <code>${themeFileNameForSlot(session.type, norm.slot)}</code>. Envie a imagem.`,
        uploadStepKeyboard(Markup)
      );
      return true;
    }

    return false;
  }

  async function handleMedia(ctx) {
    if (!isAdmin(ctx.from?.id) || ctx.chat?.type !== 'private') return false;
    const session = getSession(ctx.from.id);
    if (!session?.type) return false;

    const media = extractMedia(ctx.message);
    if (!media) {
      await replyWaText(Msg, ctx, '⚠️ Envie uma <b>foto</b> ou imagem em documento.');
      return true;
    }

    await processUpload(ctx, session, media);
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
    if (msg.photo || msg.document) {
      const handled = await handleMedia(ctx);
      if (handled) return;
    }
    return next();
  });

  logger.info('Upload fotos divulgação registrado (/foto_hanork, /foto_smm, /foto_numeros, a_divulgacao_menu)', {
    category: 'HANORK',
    module: 'WA',
  });
}

module.exports = { registerWaPromoPhotoUpload, hasSession, clearSession };
