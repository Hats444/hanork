'use strict';

const { getZeroDivuClient } = require('./ZeroDivuClient');
const { getZeroDivuContentService } = require('./ZeroDivuContent');
const { sendWaCommand, createRunWa, replyIfAckFailed, offlineMessage, mutateWa } = require('./waIpcHelper');
const { parseWaArgs, isWaCancelCommand } = require('./waCommandParse');

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function truncate(s, max = 500) {
  const t = String(s || '');
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

function formatCampaignsList(campaigns) {
  if (!campaigns?.length) return ' Catálogo vazio — cadastre produtos ativos no Hanork e rode <code>/wa_sync_catalog</code>';
  return campaigns
    .map((c) => {
      const mode = c.catalogOnly ? ' (só produtos do catálogo)' : '';
      const n = c.variacoes ?? 0;
      const label = n ? `${n} produto(s) na rotação` : 'aguardando sync';
      return `• <b>${escapeHtml(c.id)}</b> — ${label}${mode}`;
    })
    .join('\n');
}

function formatTexts(campaign, data) {
  const vars = data?.variacoes || [];
  if (!vars.length) return `Campanha <code>${campaign}</code> sem textos.`;
  const blocks = vars.slice(0, 8).map((v, i) => {
    const tipo = v.tipo || `v${i + 1}`;
    return `<b>${escapeHtml(tipo)}</b>\n${escapeHtml(truncate(v.texto, 600))}`;
  });
  let out = ` <b>Campanha ${escapeHtml(campaign)}</b>\n\n${blocks.join('\n\n')}`;
  if (vars.length > 8) out += `\n\n<i>… +${vars.length - 8} variação(ões)</i>`;
  return out;
}

function formatMediaList(campaign, files) {
  if (!files?.length) {
    return ` Campanha <code>${campaign}</code> — sem mídia na pasta.`;
  }
  const lines = files.slice(0, 20).map((f) => {
    const kb = Math.round((f.size || 0) / 1024);
    return `• <code>${escapeHtml(f.name)}</code> (${f.type}, ${kb} KB)`;
  });
  return ` <b>Mídia · ${escapeHtml(campaign)}</b>\n\n${lines.join('\n')}`;
}

function registerZeroDivuContent(bot, deps) {
  const { isAdmin, Msg, logger, deferBackground } = deps;
  const client = getZeroDivuClient();
  const content = getZeroDivuContentService();

  const guard = (ctx) => {
    if (!isAdmin(ctx.from?.id)) {
      Msg.reply(ctx, ' Acesso negado.');
      return false;
    }
    if (ctx.chat?.type !== 'private') {
      Msg.reply(ctx, ' Comandos <code>/wa_*</code> só no PV.', { parse_mode: 'HTML' });
      return false;
    }
    return true;
  };

  const offlineMsg = (ack) => offlineMessage(ack);

  const runWa = createRunWa({ guard, Msg, logger, deferBackground, client });

  bot.command(
    'wa_campanhas',
    runWa('/wa_campanhas', async (ctx) => {
      const ack = await sendWaCommand(client, 'wa.list_campaigns', {}, ctx.from.id, {
        requireOnline: true,
      });
      if (await replyIfAckFailed(Msg, ctx, ack, '')) return;
      const list = ack.result?.campaigns || ack.result?.result?.campaigns || [];
      await Msg.reply(ctx, ` <b>Campanhas</b>\n\n${formatCampaignsList(list)}`, {
        parse_mode: 'HTML',
      });
    })
  );

  bot.command(
    'wa_texto',
    runWa('/wa_texto', async (ctx) => {
      const campaign = parseWaArgs(ctx, 'wa_texto').split(/\s+/)[0];
      if (!campaign) {
        await Msg.reply(ctx, 'Uso: <code>/wa_texto zero</code> ou <code>hanork</code>', {
          parse_mode: 'HTML',
        });
        return;
      }
      const ack = await sendWaCommand(client, 'wa.get_text', { campaign }, ctx.from.id, {
        requireOnline: true,
      });
      if (await replyIfAckFailed(Msg, ctx, ack, '')) return;
      const data = ack.result?.result || ack.result || {};
      await Msg.reply(ctx, formatTexts(campaign, data), { parse_mode: 'HTML' });
    })
  );

  bot.command(
    'wa_texto_set',
    runWa('/wa_texto_set', async (ctx) => {
      const campaign = parseWaArgs(ctx, 'wa_texto_set').split(/\s+/)[0];
      if (!campaign) {
        await Msg.reply(ctx, 'Uso: <code>/wa_texto_set zero</code> — depois envie o novo texto.', {
          parse_mode: 'HTML',
        });
        return;
      }
      content.beginTextSet(ctx.from.id, campaign, 'replace_all');
      await Msg.reply(
        ctx,
        ` Envie agora o <b>novo bloco de texto</b> para campanha <code>${campaign}</code>.\n` +
          '<i>Substitui todas as variações por este texto (tipo telegram).</i>\n' +
          'Cancelar: <code>/cancelar</code>',
        { parse_mode: 'HTML' }
      );
    })
  );

  bot.command(
    'wa_midia',
    runWa('/wa_midia', async (ctx) => {
      const campaign = parseWaArgs(ctx, 'wa_midia').split(/\s+/)[0];
      if (!campaign) {
        await Msg.reply(ctx, 'Uso: <code>/wa_midia zero</code>', { parse_mode: 'HTML' });
        return;
      }
      const ack = await sendWaCommand(client, 'wa.list_media', { campaign }, ctx.from.id, {
        requireOnline: true,
      });
      if (await replyIfAckFailed(Msg, ctx, ack, '')) return;
      const data = ack.result?.result || ack.result || {};
      await Msg.reply(ctx, formatMediaList(campaign, data.files), { parse_mode: 'HTML' });
    })
  );

  bot.command(
    'wa_midia_rem',
    runWa('/wa_midia_rem', async (ctx) => {
      const parts = parseWaArgs(ctx, 'wa_midia_rem').split(/\s+/);
      const campaign = parts[0];
      const filename = parts.slice(1).join(' ');
      if (!campaign || !filename) {
        await Msg.reply(ctx, 'Uso: <code>/wa_midia_rem zero arquivo.jpg</code>', {
          parse_mode: 'HTML',
        });
        return;
      }
      const ack = await mutateWa(client, 'wa.remove_media', { campaign, filename }, ctx.from.id);
      if (await replyIfAckFailed(Msg, ctx, ack, '')) return;
      await Msg.reply(ctx, ` Removido de <code>${campaign}</code>.`, { parse_mode: 'HTML' });
    })
  );

  bot.command(
    'wa_reload_config',
    runWa('/wa_reload_config', async (ctx) => {
      const ack = await mutateWa(client, 'wa.reload_config', {}, ctx.from.id);
      if (await replyIfAckFailed(Msg, ctx, ack, '')) return;
      const r = ack.result?.result || ack.result || {};
      await Msg.reply(
        ctx,
        ` Config recarregada · <b>${r.campaigns ?? '?'}</b> campanha(s)\n<i>Sem restart do processo.</i>`,
        { parse_mode: 'HTML' }
      );
    })
  );

  bot.command('wa_midia_add', runWa('/wa_midia_add', async (ctx) => {
    const campaign = parseWaArgs(ctx, 'wa_midia_add').split(/\s+/)[0];
    if (!campaign) {
      await Msg.reply(ctx, 'Uso: <code>/wa_midia_add zero</code> — depois envie foto/vídeo.', {
        parse_mode: 'HTML',
      });
      return;
    }
    content.beginMediaUpload(ctx.from.id, campaign);
    await Msg.reply(
      ctx,
      ` Envie <b>foto ou vídeo</b> para campanha <code>${campaign}</code>.\n` +
        'Ou envie mídia com legenda <code>wa_midia zero</code>',
      { parse_mode: 'HTML' }
    );
  }));

  bot.use(async (ctx, next) => {
    if (!isAdmin(ctx.from?.id) || ctx.chat?.type !== 'private') return next();

    if (isWaCancelCommand(ctx) && content.isAwaiting(ctx.from.id)) {
      content.cancel(ctx.from.id);
      await Msg.reply(ctx, ' Operação cancelada.');
      return;
    }

    if (ctx.message?.text && !ctx.message.text.startsWith('/')) {
      const handled = await content.tryHandlePendingText(ctx, client, Msg);
      if (handled) return;
    }

    return next();
  });

  bot.on('photo', async (ctx, next) => {
    if (!isAdmin(ctx.from?.id) || ctx.chat?.type !== 'private') return next();
    const captionCamp = content.parseMediaCaption(ctx.message?.caption);
    const pendingCamp = content.getPendingMediaCampaign(ctx.from.id);
    const campaign = captionCamp || pendingCamp;
    if (!campaign) return next();

    const photos = ctx.message.photo || [];
    const best = photos[photos.length - 1];
    if (!best?.file_id) return next();

    deferBackground('wa-upload-photo', async () => {
      await content.uploadFromTelegram(ctx, client, Msg, {
        fileId: best.file_id,
        filename: `tg-${Date.now()}.jpg`,
        mimeType: 'image/jpeg',
        campaign,
      });
    });
  });

  bot.on('video', async (ctx, next) => {
    if (!isAdmin(ctx.from?.id) || ctx.chat?.type !== 'private') return next();
    const captionCamp = content.parseMediaCaption(ctx.message?.caption);
    const pendingCamp = content.getPendingMediaCampaign(ctx.from.id);
    const campaign = captionCamp || pendingCamp;
    if (!campaign) return next();

    const vid = ctx.message.video;
    if (!vid?.file_id) return next();

    deferBackground('wa-upload-video', async () => {
      await content.uploadFromTelegram(ctx, client, Msg, {
        fileId: vid.file_id,
        filename: vid.file_name || `tg-${Date.now()}.mp4`,
        mimeType: vid.mime_type || 'video/mp4',
        campaign,
      });
    });
  });
}

module.exports = { registerZeroDivuContent, formatCampaignsList, formatTexts, formatMediaList };
