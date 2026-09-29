'use strict';

const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const { runProductTelegramBroadcast } = require('../../telegram/admin/productBroadcast');

function stripHtml(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function readPhotoBuffer(photoInput, photosDir) {
  if (!photoInput) return null;
  if (typeof photoInput === 'string') {
    if (/^https?:\/\//i.test(photoInput)) {
      const res = await axios.get(photoInput, {
        responseType: 'arraybuffer',
        maxContentLength: 8 * 1024 * 1024,
        timeout: 60000,
      });
      return Buffer.from(res.data);
    }
    const fp = path.isAbsolute(photoInput)
      ? photoInput
      : path.join(photosDir || '', photoInput);
    if (fs.existsSync(fp)) return fs.readFile(fp);
    return null;
  }
  if (photoInput.source) {
    if (Buffer.isBuffer(photoInput.source)) return photoInput.source;
    if (typeof photoInput.source === 'string') {
      return readPhotoBuffer(photoInput.source, photosDir);
    }
  }
  if (photoInput.url) return readPhotoBuffer(photoInput.url, photosDir);
  return null;
}

async function stageProductPhoto(photoInput, photosDir, namePrefix) {
  const buf = await readPhotoBuffer(photoInput, photosDir);
  if (!buf?.length) return null;
  const { stageBufferToAllInboxes } = require('./waPromoFanout');
  const name = `prod-${namePrefix}-${Date.now()}.jpg`;
  return stageBufferToAllInboxes(buf, name);
}

async function resolveBotUsername(deps, ctx) {
  if (ctx?.telegram) {
    try {
      const me = await ctx.telegram.getMe();
      return me.username || '';
    } catch {
      /* ignore */
    }
  }
  if (typeof deps.getBotUsername === 'function') {
    try {
      return (await deps.getBotUsername()) || '';
    } catch {
      /* ignore */
    }
  }
  return process.env.BOT_USERNAME || '';
}

async function enqueueTypedPromo(deps, type, opts = {}) {
  const photosDir = deps.CONFIG?.CAMINHO_FOTOS || null;
  const username = await resolveBotUsername(deps, null);
  let picked;
  let waText;

  if (type === 'smm') {
    const { pickSmmBroadcast, buildSmmWaText, isSmmBroadcastEnabled } = require('../../data/smmBroadcastVariants');
    if (!isSmmBroadcastEnabled()) return { ok: false, error: 'smm_broadcast_disabled' };
    picked = pickSmmBroadcast({}, photosDir);
    waText = buildSmmWaText(picked.variant, { username });
  } else if (type === 'virtuo') {
    const { pickVirtuoBroadcast, buildVirtuoWaText, isVirtuoBroadcastEnabled } = require('../../data/virtuoBroadcastVariants');
    if (!isVirtuoBroadcastEnabled()) return { ok: false, error: 'virtuo_broadcast_disabled' };
    picked = pickVirtuoBroadcast({}, photosDir);
    waText = buildVirtuoWaText(picked.variant, { username });
  } else if (type === 'wadv') {
    const { pickWadvBroadcast, buildWadvWaText, isWadvBroadcastEnabled } = require('../../data/wadvBroadcastVariants');
    if (!isWadvBroadcastEnabled()) return { ok: false, error: 'wadv_broadcast_disabled' };
    picked = pickWadvBroadcast({}, photosDir);
    waText = buildWadvWaText(picked.variant, { username });
  } else {
    return { ok: false, error: 'invalid_type' };
  }

  const stagingName = await stageProductPhoto(
    picked.photo || picked.photoPath,
    photosDir,
    type
  ).catch(() => null);

  const adminId = opts.adminId ?? deps.CONFIG?.ID_DONO?.[0] ?? null;
  const delayMs = Math.max(0, Number(opts.delayMs) || 0);
  const idempotencyKey =
    opts.idempotencyKey || `${type}-promo-${adminId || 'system'}-${Date.now()}`;

  const productName =
    type === 'smm' ? 'SMM' : type === 'virtuo' ? 'Números SMS' : 'Hanork Div VIP';

  const { enqueuePromoOnAllSessions } = require('./waPromoFanout');
  const out = await enqueuePromoOnAllSessions(
    adminId,
    () => ({
      text: waText,
      chatText: waText,
      stagingName,
      productId: null,
      productName,
      adminId,
      source: opts.source || `hanork_${type}`,
    }),
    {
      idempotencyKey,
      delayMs,
      processNow: opts.processNow,
      sessionId: opts.sessionId,
      logger: deps.logger || null,
    }
  );

  if (!out.ok) {
    return { ok: false, offline: true, message: out.message || 'Falha ao enfileirar promo WA' };
  }

  out.variantId = picked.variant?.id;
  return out;
}

async function enqueueSmmPromo(deps, opts = {}) {
  return enqueueTypedPromo(deps, 'smm', opts);
}

async function enqueueVirtuoPromo(deps, opts = {}) {
  return enqueueTypedPromo(deps, 'virtuo', opts);
}

async function enqueueWadvPromo(deps, opts = {}) {
  return enqueueTypedPromo(deps, 'wadv', opts);
}

async function buildProductPromoPayload(deps, productId, ctxOrOpts = null) {
  const { loadProducts, prisma, CONFIG } = deps;
  const prods = await loadProducts();
  const p = prods.find((x) => x.id === productId);
  if (!p) return { ok: false, error: 'not_found' };

  try {
    const { isDivulgacaoEligibleProduct } = require('./divulgacaoCatalog');
    if (!isDivulgacaoEligibleProduct(p)) {
      return { ok: false, error: 'not_eligible', message: 'Produto não entra na divulgação automática.' };
    }
  } catch {
    /* ignore */
  }

  const sale = prisma.flashSale?.findActive(productId);
  const preco = sale ? Number(sale.sale_price) : Number(p.price);
  const username = await resolveBotUsername(deps, ctxOrOpts?.telegram ? ctxOrOpts : null);
  const botLink = username ? `https://t.me/${username}?start=buy_${p.id}` : null;

  const { generateProductPromoPlain } = require('../../utils/broadcastAiCopy');
  const { prepareWaPromoPlain, prepareWaChatPlain } = require('../../utils/waCaptionPrepare');
  const { buildWaChatPromo } = require('../../utils/persuasiveProductCopy');
  let text = await generateProductPromoPlain(p, {
    sale,
    username,
    dbRaw: deps.dbRaw || null,
    channel: 'wa',
    stableCopy: true,
  });
  text = prepareWaPromoPlain(text, {
    productName: p.name,
    productId: p.id,
    username,
  });

  const chatText = prepareWaChatPlain(buildWaChatPromo(p, { sale, username }), {
    productName: p.name,
    productId: p.id,
    username,
  });

  const { resolveProductPhotoWithMenuFallback } = require('../../utils/productPhoto');
  const { photo, usedMenuFallback } = resolveProductPhotoWithMenuFallback(
    p,
    CONFIG?.CAMINHO_FOTOS || null,
    `wa-promo:${p.id}`
  );
  const stagingName = await stageProductPhoto(
    photo,
    CONFIG?.CAMINHO_FOTOS,
    p.id
  ).catch(() => null);

  return {
    ok: true,
    product: p,
    text,
    chatText,
    stagingName,
    productId: p.id,
    productName: p.name,
    usedMenuFallback,
  };
}

async function enqueueProductPromoById(deps, productId, opts = {}) {
  const payload = await buildProductPromoPayload(deps, productId, null);
  if (!payload.ok) return payload;

  const adminId = opts.adminId ?? deps.CONFIG?.ID_DONO?.[0] ?? null;
  const idempotencyKey =
    opts.idempotencyKey ||
    `prod-${payload.productId}-${adminId || 'system'}-${Date.now()}`;
  const delayMs = Math.max(0, Number(opts.delayMs) || 0);

  const { enqueuePromoOnAllSessions } = require('./waPromoFanout');
  const out = await enqueuePromoOnAllSessions(
    adminId,
    () => ({
      text: payload.text,
      chatText: payload.chatText,
      stagingName: payload.stagingName,
      productId: payload.productId,
      productName: payload.productName,
      adminId,
      source: opts.source || 'hanork_product',
    }),
    {
      idempotencyKey,
      delayMs,
      processNow: opts.processNow,
      sessionId: opts.sessionId,
      logger: deps.logger || null,
    }
  );

  if (!out.ok) {
    return {
      ok: false,
      offline: true,
      message: out.message || 'WhatsApp worker offline — inicie o Zero Divu.',
    };
  }

  out.productName = payload.productName;
  if (out.processed && out.sent != null) {
    out.waProductName = payload.productName;
  }
  return out;
}

async function enqueueProductPromo(deps, ctx, productId, opts = {}) {
  const payload = await buildProductPromoPayload(deps, productId, ctx);
  if (!payload.ok) return payload;

  return enqueueProductPromoById(deps, productId, {
    ...opts,
    adminId: ctx.from?.id,
    idempotencyKey: opts.idempotencyKey || `prod-${payload.productId}-${ctx.from.id}`,
    source: opts.source || 'hanork_product',
  });
}

async function replyWaPromoResult(ctx, Msg, r) {
  if (!r.ok) {
    await Msg.reply(ctx, ` ${r.message || r.error}`, { parse_mode: 'HTML' });
    return;
  }
  const dual = Array.isArray(r.sessions) && r.sessions.length > 1;
  let msg =
    ` <b>WhatsApp Status</b>\n\n` +
    ` ${r.productName}\n`;
  if (dual) {
    const lines = r.sessions.map((s) => {
      const tag = s.sessionId === 'wa_b' ? 'WA 2' : 'WA 1';
      if (!s.ok) return `${tag}: falhou`;
      return `${tag}: job <code>${s.jobId || '?'}</code>`;
    });
    msg += lines.join('\n');
  } else {
    msg += `🆔 Job <code>${r.jobId}</code>`;
  }
  if (r.duplicate) msg += '\n<i>Já estava na fila — reutilizado.</i>';
  const sent = dual ? r.sentTotal : r.sent;
  if (r.processed && sent != null) {
    msg += `\n\n Postado em <b>${sent}</b> grupo(s) (Status com foto)`;
    if (dual) msg += '\n<i>Cada número só nos grupos dele.</i>';
  } else if (r.processAfter) {
    const when = new Date(r.processAfter);
    const mins = Math.max(1, Math.round((when.getTime() - Date.now()) / 60000));
    msg += `\n\n⏳ Agendado em ~${mins} min (anti-rajada TG+WA)`;
    msg += `\nFila: ${r.pending ?? 1} · <code>/wa_postar</code> força agora`;
  } else {
    msg += `\n\n⏳ Na fila (${r.pending ?? 1}) — processa no próximo ciclo ou <code>/wa_postar</code>`;
  }
  await Msg.reply(ctx, msg, { parse_mode: 'HTML' });
}

let productBcastHandlersWired = false;

function registerProductBroadcastHandlers(bot, deps) {
  if (productBcastHandlersWired) return;
  productBcastHandlersWired = true;

  const { isAdmin, Msg, logger, deferBackground } = deps;
  const { guardDivulgacaoBusy, prepareFullDivulgacao } = require('./fullDivulgacao');
  const zeroOn = require('./config').isZeroDivuEnabled();

  const tgModes = {
    pv: 'users',
    gr: 'groups',
    cn: 'channels',
    tg: 'full',
  };

  for (const [key, mode] of Object.entries(tgModes)) {
    bot.action(new RegExp(`^bcast_prod_${key}_(\\d+)$`), async (ctx) => {
      if (!isAdmin(ctx.from?.id)) return;
      if (guardDivulgacaoBusy(ctx, deps)) return;
      const pid = parseInt(ctx.match[1], 10);
      await ctx.answerCbQuery?.().catch(() => { });
      await prepareFullDivulgacao(deps).catch(() => { });
      const r = await runProductTelegramBroadcast(ctx, pid, deps, mode);
      if (!r.ok && r.message) {
        await ctx.answerCbQuery(r.message, { show_alert: true }).catch(() => { });
      }
    });
  }

  if (!zeroOn) {
    logger.info('[Promo] Handlers TG produto registrados (Zero Divu off — sem WA)', {
      category: 'HANORK',
      module: 'BCAST',
    });
    return;
  }

  bot.action(/^bcast_prod_wa_(\d+)$/, async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return;
    if (guardDivulgacaoBusy(ctx, deps)) return;
    const pid = parseInt(ctx.match[1], 10);
    await ctx.answerCbQuery(' WhatsApp Status…').catch(() => { });
    deferBackground('bcast-prod-wa', async () => {
      await prepareFullDivulgacao(deps).catch(() => { });
      const r = await enqueueProductPromo(deps, ctx, pid, { processNow: true });
      await replyWaPromoResult(ctx, Msg, r);
    });
  });

  bot.action(/^bcast_prod_all_(\d+)$/, async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return;
    if (guardDivulgacaoBusy(ctx, deps)) return;
    const pid = parseInt(ctx.match[1], 10);
    await ctx.answerCbQuery(' Telegram + WhatsApp…').catch(() => { });
    deferBackground('bcast-prod-all', async () => {
      const { prepareFullDivulgacao } = require('./fullDivulgacao');
      const { randomWaPromoDelayMs } = require('./hanorkAutoSync');
      await prepareFullDivulgacao(deps).catch(() => { });
      const waDelayMs = randomWaPromoDelayMs('manual');
      const tg = await runProductTelegramBroadcast(ctx, pid, deps, 'full');
      const wa = await enqueueProductPromo(deps, ctx, pid, {
        processNow: false,
        delayMs: waDelayMs,
      });
      let msg = '';
      if (wa.ok) {
        msg += wa.processed
          ? ` WA:  ${wa.sent ?? 0} grupo(s) · <code>${wa.jobId}</code>\n`
          : wa.processAfter
            ? ` WA: agendado (~${Math.round(waDelayMs / 60000)} min) · <code>${wa.jobId}</code>\n`
            : ` WA: enfileirado (<code>${wa.jobId}</code>)\n`;
      } else {
        msg += ` WA:  ${wa.message || wa.error}\n`;
      }
      if (tg.ok) {
        msg += ' Telegram: divulgação completa iniciada (painel atualiza ao terminar).';
      } else {
        msg += ` Telegram:  ${tg.message || tg.error}`;
      }
      await Msg.reply(ctx, msg, { parse_mode: 'HTML' });
    });
  });

  bot.action(/^bcast_prod_both_(\d+)$/, async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return;
    if (guardDivulgacaoBusy(ctx, deps)) return;
    const pid = parseInt(ctx.match[1], 10);
    await ctx.answerCbQuery(' Telegram + WhatsApp…').catch(() => { });
    deferBackground('bcast-prod-both', async () => {
      const { prepareFullDivulgacao } = require('./fullDivulgacao');
      const { randomWaPromoDelayMs } = require('./hanorkAutoSync');
      await prepareFullDivulgacao(deps).catch(() => { });
      const waDelayMs = randomWaPromoDelayMs('manual');
      const tg = await runProductTelegramBroadcast(ctx, pid, deps, 'full');
      const wa = await enqueueProductPromo(deps, ctx, pid, {
        processNow: false,
        delayMs: waDelayMs,
      });
      let msg = '';
      if (wa.ok) {
        msg += wa.processed
          ? ` WA:  ${wa.sent ?? 0} grupo(s) · <code>${wa.jobId}</code>\n`
          : wa.processAfter
            ? ` WA: agendado (~${Math.round(waDelayMs / 60000)} min) · <code>${wa.jobId}</code>\n`
            : ` WA: enfileirado (<code>${wa.jobId}</code>)\n`;
      } else {
        msg += ` WA:  ${wa.message || wa.error}\n`;
      }
      if (tg.ok) {
        msg += ' Telegram: divulgação completa iniciada (painel atualiza ao terminar).';
      } else {
        msg += ` Telegram:  ${tg.message || tg.error}`;
      }
      await Msg.reply(ctx, msg, { parse_mode: 'HTML' });
    });
  });

  logger.info('Integração promo produto → WhatsApp registrada', {
    category: 'HANORK',
    module: 'WA',
  });
}

function registerZeroDivuPromo(bot, deps) {
  registerProductBroadcastHandlers(bot, deps);
}

module.exports = {
  registerProductBroadcastHandlers,
  registerZeroDivuPromo,
  enqueueProductPromo,
  enqueueProductPromoById,
  enqueueSmmPromo,
  enqueueVirtuoPromo,
  enqueueWadvPromo,
  enqueueTypedPromo,
  buildProductPromoPayload,
  stripHtml,
  readPhotoBuffer,
};
