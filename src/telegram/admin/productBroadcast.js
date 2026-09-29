'use strict';

/**
 * Divulgação de produto no Telegram (PV / grupos / canais / completo + ponte).
 */
async function runProductTelegramBroadcast(ctx, pid, deps, mode = 'full') {
  const {
    isAdmin,
    loadProducts,
    prisma,
    broadcastService,
    executeFullBroadcast,
    runBridgePromoAfterBot,
    BroadcastService,
    deferBackground,
    sendProgressPanel,
    updateAdminPanelMessage,
    Markup,
    logger,
    CONFIG,
  } = deps;

  if (!isAdmin(ctx.from?.id)) return { ok: false, error: 'denied' };
  const prods = await loadProducts();
  const p = prods.find((x) => x.id === pid);
  if (!p) return { ok: false, error: 'not_found' };

  try {
    const { isDivulgacaoEligibleProduct } = require('../../plugins/zero-divu/divulgacaoCatalog');
    if (!isDivulgacaoEligibleProduct(p)) {
      return { ok: false, error: 'not_eligible', message: 'Este produto não entra na divulgação automática.' };
    }
  } catch {
    /* plugin opcional */
  }
  const { isDivulgacaoBusy } = require('../../plugins/zero-divu/fullDivulgacao');
  if (
    isDivulgacaoBusy({
      broadcastService,
      autoBroadcastService: deps.autoBroadcastService,
    })
  ) {
    return { ok: false, error: 'busy', message: 'Já há uma divulgação em andamento.' };
  }

  const modeLabels = {
    full: 'Usuários + grupos + canais + ponte MTProto',
    users: 'Somente PV (usuários)',
    groups: 'Somente grupos (bot)',
    channels: 'Somente canais',
  };
  const modeLabel = modeLabels[mode] || modeLabels.full;

  await ctx.answerCbQuery?.('📢 Iniciando divulgação…').catch(() => { });

  const panelChatId = ctx.chat?.id;
  const panelMessageId = await sendProgressPanel(
    ctx.telegram,
    panelChatId,
    ctx.callbackQuery?.message?.message_id,
    `⏳ <b>Divulgando ${p.name}</b>\n\n<i>${modeLabel}</i>`,
    Markup.inlineKeyboard([[{ text: '🔙 Admin', callback_data: 'a_menu' }]])
  );

  const sale = prisma.flashSale?.findActive(pid);
  const preco = sale ? sale.sale_price : Number(p.price);
  const precoTxt = sale
    ? `<s>R$ ${Number(p.price).toFixed(2)}</s> ➜ <b>R$ ${preco.toFixed(2)}</b> 🔥`
    : `<b>R$ ${preco.toFixed(2)}</b>`;

  let botLink = null;
  try {
    const me = await ctx.telegram.getMe();
    botLink = `https://t.me/${me.username}?start=buy_${p.id}`;
  } catch {
    /* ignore */
  }

  const { generateProductPromoHtml } = require('../../utils/broadcastAiCopy');
  const { buyBtn, groupBuyBtn } = require('../../utils/buttonLabels');
  const texto = await generateProductPromoHtml(p, {
    sale: sale || null,
    botLink,
    dbRaw: deps.dbRaw,
    channel: 'tg',
  });

  const bcastKeyboard = botLink
    ? Markup.inlineKeyboard([
      [{ text: buyBtn(preco), url: botLink }],
      [{ text: '📦 Ver produto', callback_data: `p_${p.id}` }],
      [{ text: '🛍️ Catálogo', callback_data: 'cat' }],
    ])
    : Markup.inlineKeyboard([
      [{ text: '📦 Ver produto', callback_data: `p_${p.id}` }],
      [{ text: '🛍️ Catálogo', callback_data: 'cat' }],
    ]);

  const { buildGroupPromoKeyboard } = require('../groupPromo');
  const { resolveProductPhotoWithMenuFallback } = require('../../utils/productPhoto');
  let botUser = process.env.BOT_USERNAME || '';
  try {
    const me = await ctx.telegram.getMe();
    botUser = me.username || botUser;
  } catch {
    /* ignore */
  }

  const groupKb = buildGroupPromoKeyboard(botUser, {
    buyProductId: p.id,
    buyLabel: groupBuyBtn(preco),
  });
  const { photo } = resolveProductPhotoWithMenuFallback(
    p,
    CONFIG?.CAMINHO_FOTOS || null,
    `tg-bcast:${p.id}`
  );
  const { resolvePvUserDelayMs } = require('../../config/broadcastConfig');
  const bcastOpts = {
    photo,
    userDelayMs: resolvePvUserDelayMs(),
    groupCooldownMs: 0,
    cooldownMode: 'new_only',
    enforceAutoRateLimit: false, // manual admin — sem limite 2×/12h
    groupReplyMarkup: groupKb,
    channelReplyMarkup: groupKb,
    skipPermissionCheck: true,
    syncGroupsFirst: true,
    syncChannelsFirst: true,
    groupDelayMs: 800,
    excludeUserIds: [ctx.from.id],
  };

  deferBackground(`bcast-prod-${mode}`, async () => {
    const t0 = Date.now();
    let resultado;
    try {
      if (mode === 'users') {
        resultado = await broadcastService.executeBroadcast(texto, 'HTML', bcastKeyboard);
        resultado = { success: true, users: resultado, groups: null, channels: null };
      } else if (mode === 'groups') {
        const groups = await broadcastService.executeGroupBroadcast(
          texto,
          'HTML',
          groupKb,
          bcastOpts
        );
        resultado = { success: groups.success !== false, groups, users: null, channels: null };
      } else if (mode === 'channels') {
        const channels = await broadcastService.executeChannelBroadcast(
          texto,
          'HTML',
          groupKb,
          bcastOpts
        );
        resultado = { success: channels.success !== false, channels, users: null, groups: null };
      } else {
        resultado = await executeFullBroadcast(texto, 'HTML', bcastKeyboard, bcastOpts);
        if (resultado?.success && typeof runBridgePromoAfterBot === 'function') {
          const bridgePromo = await runBridgePromoAfterBot({
            texto,
            photo,
            groupReplyMarkup: groupKb,
            source: 'manual_product',
          });
          resultado = { ...resultado, bridgePromo };
        }
      }
    } catch (e) {
      logger.error('[Broadcast] bcast_prod:', e.message);
      await updateAdminPanelMessage(
        ctx.telegram,
        panelChatId,
        panelMessageId,
        `❌ Erro na divulgação: ${e.message}`,
        Markup.inlineKeyboard([[{ text: '🔙 Admin', callback_data: 'a_menu' }]])
      );
      return;
    }

    const sec = Math.round((Date.now() - t0) / 1000);
    let body;
    if (mode === 'users') {
      body = `${BroadcastService.formatUserResult(resultado.users || resultado)}\n\n<i>Concluído em ${sec}s</i>`;
    } else if (mode === 'groups') {
      body = `${BroadcastService.formatGroupResult(resultado.groups || resultado)}\n\n<i>Concluído em ${sec}s</i>`;
    } else if (mode === 'channels') {
      body = `${BroadcastService.formatChannelResult(resultado.channels || resultado)}\n\n<i>Concluído em ${sec}s</i>`;
    } else {
      body = `${BroadcastService.formatFullResult(resultado)}\n\n<i>Concluído em ${sec}s</i>`;
    }

    await updateAdminPanelMessage(
      ctx.telegram,
      panelChatId,
      panelMessageId,
      body,
      Markup.inlineKeyboard([[{ text: '🔙 Admin', callback_data: 'a_menu' }]])
    );
  });

  return { ok: true, product: p };
}

module.exports = { runProductTelegramBroadcast };
