'use strict';

const { getZeroDivuClient } = require('./ZeroDivuClient');
const { DEFAULT_SECONDARY } = require('./waSessionsManifest');
const waPanel = require('./waPanelUi');
const { formatStatus, formatStatusStats } = require('./ZeroDivuCommands');
const { getZeroDivuLoginService } = require('./ZeroDivuLoginService');
const { sendWaCommand, offlineMessage, mutateWa, refreshWorkerState, staleStateBanner, safeEditAdminPanel, PANEL_IPC_TIMEOUT_MS } = require('./waIpcHelper');
const { toTwoCols } = require('../../telegram/menus/twoColKeyboard');
const waPostFeedback = require('./waPostFeedback');

function waGuard(ctx, isAdmin, Msg) {
  if (!isAdmin(ctx.from?.id)) {
    ctx.answerCbQuery?.('', { show_alert: true }).catch(() => {});
    return false;
  }
  if (ctx.chat?.type !== 'private') {
    ctx.answerCbQuery?.('Só no PV', { show_alert: true }).catch(() => {});
    return false;
  }
  return true;
}

function waDefer(deferBackground, logger, Msg, label, ctx, fn) {
  deferBackground(label, async () => {
    try {
      await fn();
    } catch (err) {
      logger.error(`[WA panel:${label}] ${err?.message || err}`);
      try {
        await Msg.reply(ctx, ` <b>WhatsApp</b>: ${err?.message || 'erro interno'}`, {
          parse_mode: 'HTML',
        });
      } catch {
        /* ignore */
      }
    }
  });
}

async function refreshState(client, adminId = null) {
  const { state } = await refreshWorkerState(client, adminId);
  return state;
}

function limitsText(state, limits) {
  const s = state || {};
  const l = limits || {};
  const sh = s.syncHealth || l.syncHealth || {};
  const syncLine = sh.diskActive != null
    ? `Sync: JSON <b>${sh.diskActive}</b> · WA <b>${sh.waGroups ?? '?'}</b>${sh.syncPartial ? '  parcial' : ''}`
    : '';
  return (
    `${formatStatus(s)}\n\n` +
    `<b>Limites runtime</b>\n` +
    `Max grupos: <b>${l.maxGroups ?? s.maxGroups ?? '?'}</b>\n` +
    `Min membros: <b>${l.minMembers ?? s.minMembers ?? '?'}</b>\n` +
    (syncLine ? `${syncLine}\n` : '') +
    `Posts 24h: Zero <b>${s.postsZero24h ?? 0}</b> · Hanork <b>${s.postsHanork24h ?? 0}</b>\n` +
    `Auto-join: <b>${l.autoJoinGroups ?? s.autoJoinGroups ? 'ON' : 'OFF'}</b>\n` +
    `Auto-post ao entrar: <b>${l.autoPostOnJoin ?? s.autoPostOnJoin ? 'ON' : 'OFF'}</b>\n` +
    `Joins/h (uso): <b>${l.joinsThisHour ?? s.joinsThisHour ?? 0}/${l.maxJoinsEffective ?? l.maxJoinPerHourEffective ?? l.maxJoinPerHour ?? '?'}</b>\n` +
    `Fila join: <b>${l.joinQueuePersist ?? l.joinQueue ?? s.joinQueue ?? 0}</b>\n` +
    `Convites disco: <b>${l.pendingInvitesDisk ?? s.pendingInvitesDisk ?? sh.inviteQueue ?? 0}</b>\n` +
    (l.riskPause || s.riskPause
      ? `Anti-ban: <b>${l.riskPause || s.riskPause}</b> ~${l.riskPauseMin ?? s.riskPauseMin ?? 0} min\n`
      : '') +
    `Fila promo: <b>${l.promoQueue ?? s.promoQueue ?? 0}</b>\n` +
    `Campanha hanork: <b>${(l.hanorkCampaignEnabled ?? s.hanorkCampaignEnabled) !== false ? 'ON' : 'OFF'}</b>\n` +
    `Delay post: ${l.postDelayMin ?? s.postDelayMin ?? '?'} a ${l.postDelayMax ?? s.postDelayMax ?? '?'} ms\n` +
    `Delay join: ${l.joinDelayMin ?? s.joinDelayMin ?? '?'} a ${l.joinDelayMax ?? s.joinDelayMax ?? '?'} ms\n\n` +
    `<code>/wa_preset_prod</code> · <code>/wa_limites</code> · <code>/wa_status_stats</code>\n` +
    `<code>/wa_promo_fila</code> · <code>/wa_sync_catalog</code> · <code>/wa_sync</code>`
  );
}

function groupsText(groups) {
  if (!groups?.length) return 'Nenhum grupo ativo.';
  return groups
    .slice(0, 12)
    .map(
      (g, i) =>
        `${i + 1}. <b>${escapeHtml(g.subject || g.shortId)}</b>\n` +
        `   score ${g.score ?? 0} · ${g.shortId}` +
        (g.lastPostAt ? ` · post ${new Date(g.lastPostAt).toLocaleDateString('pt-BR')}` : '')
    )
    .join('\n\n');
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function registerZeroDivuAdminPanel(bot, deps) {
  const { isAdmin, Msg, Markup, logger, deferBackground, editAdminPanel, logBridge, syncHanorkCatalog } =
    deps;
  const client = getZeroDivuClient();
  const clientB = () => getZeroDivuClient(DEFAULT_SECONDARY);
  const login = getZeroDivuLoginService();
  const waHelp = require('./waCommandsHelp');
  const ipcRead = { requireOnline: true, timeoutMs: PANEL_IPC_TIMEOUT_MS };
  const ipcMutate = { timeoutMs: PANEL_IPC_TIMEOUT_MS };

  async function renderWaPanel(ctx, pack, opts = {}) {
    let text = waPanel.buildWaOverviewText(pack, { detail: Boolean(opts.detail) });
    if (pack.staleA || pack.staleB) {
      text += staleStateBanner(pack.staleA || pack.staleB);
    }
    if (opts.prefix) {
      text = `${String(opts.prefix).trim()}\n\n${text}`;
    }
    const keyboard = waPanel.buildWaPanelKeyboard(pack, null, Markup);
    await safeEditAdminPanel(ctx, editAdminPanel, Msg, text, keyboard, logger, opts.label || 'wa-panel');
  }

  async function showWaPanel(ctx, opts = {}) {
    const cached = waPanel.getOverviewPackFromCache(client);
    await renderWaPanel(ctx, cached, { ...opts, label: 'wa-panel-cache' });

    if (opts.cachedOnly) return;

    try {
      const fresh = await waPanel.fetchOverviewStates(ctx.from.id, client, clientB(), { quickMs: 2000 });
      await renderWaPanel(ctx, fresh, { ...opts, label: 'wa-panel-fresh' });
    } catch (err) {
      logger.warn(`[WA panel] refresh falhou: ${err?.message || err}`);
    }
  }

  async function showWaPanelAfter(ctx, msg) {
    if (editAdminPanel) {
      await showWaPanel(ctx, { prefix: msg });
    } else if (msg) {
      await Msg.reply(ctx, msg, { parse_mode: 'HTML' });
    }
  }

  async function showWaHelp(ctx, section = 'all') {
    const messages = waHelp.buildWaHelpParts(section);
    const kb = waHelp.getWaHelpKeyboard(Markup, section);
    if (ctx.callbackQuery && editAdminPanel) {
      await Msg.sendLongHtml(ctx, messages, kb, { editFirst: true });
    } else {
      await Msg.sendLongHtml(ctx, messages, kb, { forceNew: true });
    }
  }

  const WA_HELP_ACTIONS = {
    a_wa_help: 'all',
    a_wa_help_all: 'all',
    a_wa_help_conn: 'conn',
    a_wa_help_ops: 'ops',
    a_wa_help_limit: 'limit',
    a_wa_help_grupos: 'grupos',
    a_wa_help_content: 'content',
    a_wa_help_loja: 'loja',
    a_wa_help_logs: 'logs',
  };

  for (const [action, section] of Object.entries(WA_HELP_ACTIONS)) {
    bot.action(action, async (ctx) => {
      if (!waGuard(ctx, isAdmin, Msg)) return;
      await ctx.answerCbQuery().catch(() => {});
      deferBackground(`wa-help-${section}`, () => showWaHelp(ctx, section));
    });
  }

  bot.action('a_wa_menu', async (ctx) => {
    if (!waGuard(ctx, isAdmin, Msg)) return;
    await ctx.answerCbQuery().catch(() => {});
    waDefer(deferBackground, logger, Msg, 'wa-panel', ctx, () => showWaPanel(ctx));
  });

  bot.action('a_wa_status', async (ctx) => {
    if (!waGuard(ctx, isAdmin, Msg)) return;
    await ctx.answerCbQuery().catch(() => {});
    waDefer(deferBackground, logger, Msg, 'wa-panel-status', ctx, () => showWaPanel(ctx, { detail: true }));
  });

  bot.action('a_wa_connect', async (ctx) => {
    if (!waGuard(ctx, isAdmin, Msg)) return;
    await ctx.answerCbQuery('Gerando QR…').catch(() => {});
    waDefer(deferBackground, logger, Msg, 'wa-panel-connect', ctx, async () => {
      const r = await login.startLogin(ctx.from.id, ctx);
      await Msg.reply(ctx, r.message, { parse_mode: 'HTML' });
    });
  });

  bot.action('a_wa2_connect', async (ctx) => {
    if (!waGuard(ctx, isAdmin, Msg)) return;
    await ctx.answerCbQuery('Gerando QR…').catch(() => {});
    waDefer(deferBackground, logger, Msg, 'wa-panel-connect-2', ctx, async () => {
      const r = await login.startLogin(ctx.from.id, ctx, DEFAULT_SECONDARY);
      await Msg.reply(ctx, r.message, { parse_mode: 'HTML' });
    });
  });

  bot.action('a_wa_config_menu', async (ctx) => {
    if (!waGuard(ctx, isAdmin, Msg)) return;
    await ctx.answerCbQuery().catch(() => {});
    waDefer(deferBackground, logger, Msg, 'wa-config-menu', ctx, async () => {
      const pack = waPanel.getOverviewPackFromCache(client);
      const text = waPanel.configMenuHint();
      const kb = waPanel.buildWaConfigKeyboard(Markup, pack.primary);
      await safeEditAdminPanel(ctx, editAdminPanel, Msg, text, kb, logger, 'wa-config-menu');
    });
  });

  bot.action('a_wa_connect_pair', async (ctx) => {
    if (!waGuard(ctx, isAdmin, Msg)) return;
    await ctx.answerCbQuery().catch(() => {});
    waDefer(deferBackground, logger, Msg, 'wa-panel-pair-1', ctx, async () => {
      const text =
        '<b>Pairing WA 1</b>\n\n' +
        'Envie no PV:\n<code>/wa_pair 5511999999999</code>\n\n' +
        'DDI + DDD + número, só dígitos.';
      const kb = Markup.inlineKeyboard(toTwoCols([[{ text: 'Voltar', callback_data: 'a_wa_config_menu' }]]));
      await safeEditAdminPanel(ctx, editAdminPanel, Msg, text, kb, logger, 'wa-panel-pair-1');
    });
  });

  bot.action('a_wa2_connect_pair', async (ctx) => {
    if (!waGuard(ctx, isAdmin, Msg)) return;
    await ctx.answerCbQuery().catch(() => {});
    waDefer(deferBackground, logger, Msg, 'wa-panel-pair-2', ctx, async () => {
      const text =
        '<b>Pairing WA 2</b>\n\n' +
        'Envie no PV:\n<code>/wa2_pair 5511999999999</code>\n\n' +
        'DDI + DDD + número, só dígitos.';
      const kb = Markup.inlineKeyboard(toTwoCols([[{ text: 'Voltar', callback_data: 'a_wa_config_menu' }]]));
      await safeEditAdminPanel(ctx, editAdminPanel, Msg, text, kb, logger, 'wa-panel-pair-2');
    });
  });

  bot.action('a_wa_preset_prod', async (ctx) => {
    if (!waGuard(ctx, isAdmin, Msg)) return;
    await ctx.answerCbQuery('Aplicando preset…').catch(() => {});
    waDefer(deferBackground, logger, Msg, 'wa-panel-preset-prod', ctx, async () => {
      const ack = await mutateWa(client, 'wa.preset_prod', {}, ctx.from.id, ipcMutate);
      const msg = ack.ok ? 'Preset produção segura aplicado.' : `${ack.message || ack.error}`;
      await showWaPanelAfter(ctx, msg);
    });
  });

  bot.action('a_wa_pair_help', async (ctx) => {
    if (!waGuard(ctx, isAdmin, Msg)) return;
    await ctx.answerCbQuery().catch(() => {});
    waDefer(deferBackground, logger, Msg, 'wa-panel-pair-help', ctx, async () => {
      const text =
        ' <b>Login por código (pairing)</b>\n\n' +
        'Envie no PV:\n<code>/wa_pair 5511999999999</code>\n\n' +
        'Substitua pelo seu número com DDI (Brasil: 55 + DDD + número).\n\n' +
        'No celular: WhatsApp → Aparelhos conectados → Conectar com número de telefone.';
      const kb = Markup.inlineKeyboard(toTwoCols([
        [{ text: 'WhatsApp', callback_data: 'a_wa_menu' }],
      ]));
      await safeEditAdminPanel(ctx, editAdminPanel, Msg, text, kb, logger, 'wa-panel-pair-help');
    });
  });

  bot.action('a_wa_pause', async (ctx) => {
    if (!waGuard(ctx, isAdmin, Msg)) return;
    await ctx.answerCbQuery('Pausando…').catch(() => {});
    waDefer(deferBackground, logger, Msg, 'wa-panel-pause', ctx, async () => {
      const ack = await mutateWa(client, 'wa.pause', {}, ctx.from.id, ipcMutate);
      const msg = ack.ok ? 'Postagens automáticas pausadas.' : `${ack.message || ack.error}`;
      await showWaPanelAfter(ctx, msg);
    });
  });

  bot.action('a_wa_resume', async (ctx) => {
    if (!waGuard(ctx, isAdmin, Msg)) return;
    await ctx.answerCbQuery('Retomando…').catch(() => {});
    waDefer(deferBackground, logger, Msg, 'wa-panel-resume', ctx, async () => {
      const ack = await mutateWa(client, 'wa.resume', {}, ctx.from.id, ipcMutate);
      const msg = ack.ok ? 'Postagens automáticas ligadas.' : `${ack.message || ack.error}`;
      await showWaPanelAfter(ctx, msg);
    });
  });

  bot.action('a_wa_post', async (ctx) => {
    if (!waGuard(ctx, isAdmin, Msg)) return;
    await ctx.answerCbQuery('Postando…').catch(() => {});
    waDefer(deferBackground, logger, Msg, 'wa-panel-post', ctx, async () => {
      const ack = await mutateWa(client, 'wa.post_now', {}, ctx.from.id, ipcMutate);
      const msg = waPostFeedback.formatPostNowReply(ack);
      await Msg.reply(ctx, msg, { parse_mode: 'HTML' });
    });
  });

  bot.action('a_wa_groups', async (ctx) => {
    if (!waGuard(ctx, isAdmin, Msg)) return;
    await ctx.answerCbQuery().catch(() => {});
    waDefer(deferBackground, logger, Msg, 'wa-panel-groups', ctx, async () => {
      const ack = await sendWaCommand(client, 'wa.list_groups', { limit: 15 }, ctx.from.id, ipcRead);
      if (!ack.ok) {
        await Msg.reply(ctx, ` ${offlineMessage(ack)}`, { parse_mode: 'HTML' });
        return;
      }
      const groups = ack.result?.groups || ack.result?.result?.groups || [];
      const text = ` <b>Grupos ativos</b>\n\n${groupsText(groups)}\n\n<code>/wa_grupo SAIR ID</code>`;
      const kb = Markup.inlineKeyboard(toTwoCols([
        [{ text: 'WhatsApp', callback_data: 'a_wa_menu' }],
        [{ text: 'Admin', callback_data: 'a_menu' }],
      ]));
      await safeEditAdminPanel(ctx, editAdminPanel, Msg, text, kb, logger, 'wa-panel-groups');
    });
  });

  bot.action('a_wa_campaigns', async (ctx) => {
    if (!waGuard(ctx, isAdmin, Msg)) return;
    await ctx.answerCbQuery().catch(() => {});
    waDefer(deferBackground, logger, Msg, 'wa-panel-campaigns', ctx, async () => {
      const ack = await sendWaCommand(client, 'wa.list_campaigns', {}, ctx.from.id, ipcRead);
      if (!ack.ok) {
        await Msg.reply(ctx, ` ${offlineMessage(ack)}`, { parse_mode: 'HTML' });
        return;
      }
      const list = ack.result?.campaigns || ack.result?.result?.campaigns || [];
      const { formatCampaignsList } = require('./ZeroDivuContentCommands');
      const text =
        ` <b>Divulgação — catálogo Hanork</b>\n\n${formatCampaignsList(list)}\n\n` +
        '<i>Só produtos cadastrados no Hanork entram no Status.</i>\n' +
        '<code>/wa_sync_catalog</code> · força sync do catálogo\n' +
        '<code>/wa_reload_config</code>';
      const kb = Markup.inlineKeyboard(toTwoCols([
        [{ text: 'WhatsApp', callback_data: 'a_wa_menu' }],
        [{ text: 'Admin', callback_data: 'a_menu' }],
      ]));
      await safeEditAdminPanel(ctx, editAdminPanel, Msg, text, kb, logger, 'wa-panel-campaigns');
    });
  });

  bot.action('a_wa_limits', async (ctx) => {
    if (!waGuard(ctx, isAdmin, Msg)) return;
    await ctx.answerCbQuery().catch(() => {});
    waDefer(deferBackground, logger, Msg, 'wa-panel-limits', ctx, async () => {
      const ack = await sendWaCommand(client, 'wa.get_limits', {}, ctx.from.id, ipcRead);
      if (!ack.ok) {
        const text = ` ${offlineMessage(ack)}`;
        const kb = Markup.inlineKeyboard(toTwoCols([
          [{ text: 'WhatsApp', callback_data: 'a_wa_menu' }],
        ]));
        await safeEditAdminPanel(ctx, editAdminPanel, Msg, text, kb, logger, 'wa-panel-limits-offline');
        return;
      }
      const state = await refreshState(client);
      const text = limitsText(state, ack.result || ack.result?.result);
      const kb = Markup.inlineKeyboard(toTwoCols([
        [{ text: 'WhatsApp', callback_data: 'a_wa_menu' }],
        [{ text: 'Admin', callback_data: 'a_menu' }],
      ]));
      await safeEditAdminPanel(ctx, editAdminPanel, Msg, text, kb, logger, 'wa-panel-limits');
    });
  });

  bot.action('a_wa_status_stats', async (ctx) => {
    if (!waGuard(ctx, isAdmin, Msg)) return;
    await ctx.answerCbQuery().catch(() => {});
    waDefer(deferBackground, logger, Msg, 'wa-panel-status-stats', ctx, async () => {
      const ack = await sendWaCommand(client, 'wa.get_status_stats', { limit: 20 }, ctx.from.id, ipcRead);
      if (!ack.ok) {
        await Msg.reply(ctx, ` ${offlineMessage(ack)}`, { parse_mode: 'HTML' });
        return;
      }
      const data = ack.result || ack.result?.result;
      const text = formatStatusStats(data);
      const kb = Markup.inlineKeyboard(toTwoCols([
        [{ text: 'WhatsApp', callback_data: 'a_wa_menu' }],
        [{ text: 'Admin', callback_data: 'a_menu' }],
      ]));
      await safeEditAdminPanel(ctx, editAdminPanel, Msg, text, kb, logger, 'wa-panel-status-stats');
    });
  });

  bot.action('a_wa_min50', async (ctx) => {
    if (!waGuard(ctx, isAdmin, Msg)) return;
    await ctx.answerCbQuery('Aplicando…').catch(() => {});
    waDefer(deferBackground, logger, Msg, 'wa-panel-min50', ctx, async () => {
      const ack = await sendWaCommand(client, 'wa.set_min_members', { n: 50 }, ctx.from.id, ipcRead);
      const msg = ack.ok ? 'Min membros = 50' : `${offlineMessage(ack)}`;
      await showWaPanelAfter(ctx, msg);
    });
  });

  bot.action('a_wa_promo_fila', async (ctx) => {
    if (!waGuard(ctx, isAdmin, Msg)) return;
    await ctx.answerCbQuery().catch(() => {});
    waDefer(deferBackground, logger, Msg, 'wa-panel-promo', ctx, async () => {
      const ack = await sendWaCommand(client, 'wa.list_promo', {}, ctx.from.id, ipcRead);
      if (!ack.ok) {
        await Msg.reply(ctx, ` ${offlineMessage(ack)}`, { parse_mode: 'HTML' });
        return;
      }
      const jobs = ack.result?.jobs || ack.result?.result?.jobs || [];
      let text;
      if (!jobs.length) {
        text = ' <b>Fila promo vazia</b>\n\nProdutos enfileirados via Broadcast ou divulgação auto Hanork.';
      } else {
        const lines = jobs
          .slice(0, 12)
          .map((j) => {
            let line = `• <code>${j.id}</code> ${escapeHtml(j.productName || 'promo')} · ${j.status}`;
            if (j.processAfter) {
              const mins = Math.max(0, Math.round((new Date(j.processAfter).getTime() - Date.now()) / 60000));
              line += mins > 0 ? ` · ~${mins} min` : ' · pronto';
            }
            return line + (j.hasImage ? ' ' : '');
          })
          .join('\n');
        text = ` <b>Fila promo WA</b> (${jobs.length})\n\n${lines}\n\n<code>/wa_postar</code> processa o próximo elegível.`;
      }
      const kb = Markup.inlineKeyboard(toTwoCols([
        [{ text: 'Processar promo', callback_data: 'a_wa_process_promo' }],
        [{ text: 'WhatsApp', callback_data: 'a_wa_menu' }],
      ]));
      await safeEditAdminPanel(ctx, editAdminPanel, Msg, text, kb, logger, 'wa-panel-promo');
    });
  });

  bot.action('a_wa_process_promo', async (ctx) => {
    if (!waGuard(ctx, isAdmin, Msg)) return;
    await ctx.answerCbQuery('Processando…').catch(() => {});
    waDefer(deferBackground, logger, Msg, 'wa-process-promo', ctx, async () => {
      const ack = await mutateWa(client, 'wa.process_promo', {}, ctx.from.id, ipcMutate);
      const msg = waPostFeedback.formatProcessPromoReply(ack);
      await Msg.reply(ctx, msg, { parse_mode: 'HTML' });
    });
  });

  bot.action('a_wa_sync_groups', async (ctx) => {
    if (!waGuard(ctx, isAdmin, Msg)) return;
    await ctx.answerCbQuery('Sincronizando…').catch(() => {});
    waDefer(deferBackground, logger, Msg, 'wa-sync-groups', ctx, async () => {
      const ack = await mutateWa(client, 'wa.sync_groups', {}, ctx.from.id, ipcMutate);
      const n =
        ack.result?.activeGroups ??
        ack.result?.count ??
        ack.result?.result?.activeGroups ??
        client.readState()?.activeGroups ??
        '?';
      const msg = ack.ok ? `Sync OK: <b>${n}</b> grupos ativos` : `${ack.message || ack.error}`;
      await showWaPanelAfter(ctx, msg);
    });
  });

  bot.action('a_wa_repor_alcance', async (ctx) => {
    if (!waGuard(ctx, isAdmin, Msg)) return;
    const { isDualWaEnabled } = require('./waSessionsManifest');
    if (!isDualWaEnabled()) {
      await ctx.answerCbQuery('Só com dual WA', { show_alert: true }).catch(() => {});
      return;
    }
    await ctx.answerCbQuery('Repondo alcance…').catch(() => {});
    waDefer(deferBackground, logger, Msg, 'wa-repor-alcance', ctx, async () => {
      const { runOverlapCleanupAll, formatOverlapPanelText } = require('./waDualOverlapAdmin');
      const out = await runOverlapCleanupAll(ctx.from.id, { timeoutMs: ipcMutate.timeoutMs });
      const text = out.ok
        ? formatOverlapPanelText(out.lines)
        : ` ${out.message || 'Falha ao repor alcance'}`;
      const kb = Markup.inlineKeyboard(
        toTwoCols([
          [{ text: 'Painel WA', callback_data: 'a_wa_menu' }],
          [{ text: 'Auto-join', callback_data: 'a_wa_autojoin_toggle' }],
        ])
      );
      await safeEditAdminPanel(ctx, editAdminPanel, Msg, text, kb, logger, 'wa-repor-alcance');
    });
  });

  bot.action('a_wa_sync_catalog', async (ctx) => {
    if (!waGuard(ctx, isAdmin, Msg)) return;
    await ctx.answerCbQuery('Sync catálogo…').catch(() => {});
    waDefer(deferBackground, logger, Msg, 'wa-sync-catalog', ctx, async () => {
      if (typeof syncHanorkCatalog !== 'function') {
        await Msg.reply(ctx, ' Sync de catálogo indisponível.', { parse_mode: 'HTML' });
        return;
      }
      const { catalogUsesAsyncAi } = require('./hanorkAutoSync');
      const useAsync = catalogUsesAsyncAi();
      const r = await syncHanorkCatalog(
        useAsync ? { asyncAi: true, source: 'manual', force: true, delayMs: 0 } : {}
      );
      if (!r?.ok) {
        await Msg.reply(
          ctx,
          ` ${r?.error === 'no_active_products' ? 'Nenhum produto ativo.' : r?.error || 'Falha'}`,
          { parse_mode: 'HTML' }
        );
        return;
      }
      const msg = r.asyncAi
        ? `Catálogo IA enfileirado (job <code>${r.jobId || 'ai:catalog'}</code>)`
        : `Catálogo Hanork sincronizado: <b>${r.count}</b> produto(s)`;
      await showWaPanelAfter(ctx, msg);
    });
  });

  bot.action('a_wa_hanork_toggle', async (ctx) => {
    if (!waGuard(ctx, isAdmin, Msg)) return;
    await ctx.answerCbQuery().catch(() => {});
    waDefer(deferBackground, logger, Msg, 'wa-hanork-toggle', ctx, async () => {
      const state = await refreshState(client);
      const on = state.hanorkCampaignEnabled !== false;
      const ack = await mutateWa(client, 'wa.set_hanork_campaign', { on: on ? 'off' : 'on' }, ctx.from.id, ipcMutate);
      const msg = ack.ok
        ? on
          ? 'Campanha <code>hanork</code> excluída da rotação WA.'
          : 'Campanha <code>hanork</code> incluída na rotação WA.'
        : `${ack.message || ack.error}`;
      await showWaPanelAfter(ctx, msg);
    });
  });

  bot.action('a_wa_autosync_toggle', async (ctx) => {
    if (!waGuard(ctx, isAdmin, Msg)) return;
    await ctx.answerCbQuery().catch(() => {});
    waDefer(deferBackground, logger, Msg, 'wa-autosync-toggle', ctx, async () => {
      const state = await refreshState(client);
      const on = state.hanorkAutoSyncEnabled !== false;
      const ack = await mutateWa(client, 'wa.set_hanork_auto_sync', { on: on ? 'off' : 'on' }, ctx.from.id, ipcMutate);
      const msg = ack.ok
        ? on
          ? 'Sync automático Hanork desligado.'
          : 'Sync automático Hanork ligado.'
        : `${offlineMessage(ack)}`;
      await showWaPanelAfter(ctx, msg);
    });
  });

  bot.action('a_wa_autojoin_toggle', async (ctx) => {
    if (!waGuard(ctx, isAdmin, Msg)) return;
    await ctx.answerCbQuery().catch(() => {});
    waDefer(deferBackground, logger, Msg, 'wa-autojoin-toggle', ctx, async () => {
      const state = await refreshState(client);
      const on = state.autoJoinGroups !== false;
      const ack = await sendWaCommand(
        client,
        'wa.set_auto_join',
        { on: on ? 'off' : 'on' },
        ctx.from.id,
        ipcRead
      );
      const msg = !ack.ok
        ? `${offlineMessage(ack)}`
        : `Auto-join: <b>${(await refreshState(client)).autoJoinGroups !== false ? 'ON' : 'OFF'}</b>`;
      await showWaPanelAfter(ctx, msg);
    });
  });

  bot.action('a_wa_autopost_toggle', async (ctx) => {
    if (!waGuard(ctx, isAdmin, Msg)) return;
    await ctx.answerCbQuery().catch(() => {});
    waDefer(deferBackground, logger, Msg, 'wa-autopost-toggle', ctx, async () => {
      const state = await refreshState(client);
      const on = state.autoPostOnJoin !== false;
      const ack = await sendWaCommand(
        client,
        'wa.set_auto_post_on_join',
        { on: on ? 'off' : 'on' },
        ctx.from.id,
        ipcRead
      );
      const msg = !ack.ok
        ? `${offlineMessage(ack)}`
        : `Post ao entrar: <b>${(await refreshState(client)).autoPostOnJoin !== false ? 'ON' : 'OFF'}</b>`;
      await showWaPanelAfter(ctx, msg);
    });
  });

  bot.action('a_wa_joins2', async (ctx) => {
    if (!waGuard(ctx, isAdmin, Msg)) return;
    await ctx.answerCbQuery('Aplicando…').catch(() => {});
    waDefer(deferBackground, logger, Msg, 'wa-panel-joins2', ctx, async () => {
      const ack = await sendWaCommand(client, 'wa.set_max_join_per_hour', { n: 2 }, ctx.from.id, ipcRead);
      const msg = ack.ok ? 'Joins/h = 2' : `${offlineMessage(ack)}`;
      await showWaPanelAfter(ctx, msg);
    });
  });

  bot.action('a_wa_joins3', async (ctx) => {
    if (!waGuard(ctx, isAdmin, Msg)) return;
    await ctx.answerCbQuery('Aplicando…').catch(() => {});
    waDefer(deferBackground, logger, Msg, 'wa-panel-joins3', ctx, async () => {
      const ack = await sendWaCommand(client, 'wa.set_max_join_per_hour', { n: 3 }, ctx.from.id, ipcRead);
      const msg = ack.ok ? 'Joins/h = 3' : `${offlineMessage(ack)}`;
      await showWaPanelAfter(ctx, msg);
    });
  });

  bot.action('a_wa_perfil_balanced', async (ctx) => {
    if (!waGuard(ctx, isAdmin, Msg)) return;
    await ctx.answerCbQuery('Perfil balanced…').catch(() => {});
    waDefer(deferBackground, logger, Msg, 'wa-panel-balanced', ctx, async () => {
      const ack1 = await sendWaCommand(
        client,
        'wa.set_profile',
        { profile: 'balanced' },
        ctx.from.id,
        ipcRead
      );
      const ack2 = ack1.ok
        ? await sendWaCommand(client, 'wa.set_max_join_per_hour', { n: 3 }, ctx.from.id, ipcRead)
        : ack1;
      const msg = ack1.ok && ack2.ok
        ? 'Perfil <code>balanced</code> aplicado.\nJoins/h = 3\n<i>Use /wa_auto on para reativar auto-perfil.</i>'
        : `${offlineMessage(ack2)}`;
      await showWaPanelAfter(ctx, msg);
    });
  });

  bot.action('a_wa_logs', async (ctx) => {
    if (!waGuard(ctx, isAdmin, Msg)) return;
    await ctx.answerCbQuery().catch(() => {});
    waDefer(deferBackground, logger, Msg, 'wa-panel-logs', ctx, async () => {
      const events = logBridge?.getRecentEvents?.(3600000) || [];
      const lines = events.length
        ? events
            .slice(-15)
            .reverse()
            .map((e) => `${new Date(e.at).toLocaleTimeString('pt-BR')} · ${e.msg}`)
            .join('\n')
        : 'Nenhum evento WA na última hora (worker parado ou sem atividade).';
      const text =
        ` <b>Logs WA (última hora)</b>\n\n<code>${lines.replace(/</g, '')}</code>\n\n` +
        '<code>/wa_logs on</code> espelha novos eventos no PV.';
      const kb = Markup.inlineKeyboard(toTwoCols([
        [{ text: 'WhatsApp', callback_data: 'a_wa_menu' }],
        [{ text: 'Admin', callback_data: 'a_menu' }],
      ]));
      await safeEditAdminPanel(ctx, editAdminPanel, Msg, text, kb, logger, 'wa-panel-logs');
    });
  });

  logger.info('Painel WhatsApp (callbacks a_wa_*) registrado', { category: 'HANORK', module: 'WA' });
}

module.exports = { registerZeroDivuAdminPanel, buildWaPanelKeyboard: waPanel.buildWaPanelKeyboard };
