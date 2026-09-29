'use strict';

const { getZeroDivuClient } = require('./ZeroDivuClient');
const {
  offlineMessage,
  sendWaCommand,
  mutateWa,
  formatLimitsText,
  createRunWa,
  replyIfAckFailed,
  refreshWorkerState,
  staleStateBanner,
} = require('./waIpcHelper');
const { parseWaArgs } = require('./waCommandParse');
const waPostFeedback = require('./waPostFeedback');

function formatJoinStatusLines(state) {
  if (!state) return '';
  const lines = [];
  const maxJ = state.maxJoinsEffective ?? state.maxJoinPerHourEffective ?? state.maxJoinPerHour;
  if (maxJ != null && state.joinsThisHour != null) {
    lines.push(`\n Entradas/h: <b>${state.joinsThisHour}/${maxJ}</b>`);
  }
  const jq = state.joinQueuePersist ?? state.joinQueue;
  if (jq > 0) lines.push(`\n Fila join (ativa): <b>${jq}</b>`);
  if (state.pendingInvitesDisk > 0) {
    lines.push(`\n Convites em disco: <b>${state.pendingInvitesDisk}</b>`);
  }
  if (state.riskPause) {
    lines.push(
      `\n Anti-ban: pausa <b>${state.riskPause}</b> ~${state.riskPauseMin || 0} min` +
        (state.riskThrottle != null && state.riskThrottle < 1
          ? ` · throttle ${Math.round(state.riskThrottle * 100)}%`
          : '')
    );
  } else if (state.antiBanWait && !state.riskPause) {
    lines.push(`\n Anti-ban: <code>${state.antiBanWait}</code>`);
  } else if (state.riskThrottle != null && state.riskThrottle < 1) {
    lines.push(`\n Throttle joins: <b>${Math.round(state.riskThrottle * 100)}%</b>`);
  }
  if (
    state.autoProfile !== false &&
    state.autoUpgradeStreak != null &&
    state.profile === 'safe'
  ) {
    lines.push(
      `\n⏳ Auto → balanced: <b>${state.autoUpgradeStreak}/${state.autoUpgradeNeed ?? 4}</b>`
    );
  }
  return lines.join('');
}

function formatPromoNextLine(promoNext) {
  if (!promoNext?.productName && !promoNext?.id) return '';
  const name = promoNext.productName || promoNext.id;
  if (promoNext.ready) return `\n   ↳ próximo: <b>${name}</b> · pronto`;
  if (promoNext.minsUntil != null && promoNext.minsUntil >= 0) {
    return `\n   ↳ próximo: <b>${name}</b> · ~${promoNext.minsUntil} min`;
  }
  if (promoNext.processAfter) {
    const mins = Math.max(
      0,
      Math.round((new Date(promoNext.processAfter).getTime() - Date.now()) / 60000)
    );
    return `\n   ↳ próximo: <b>${name}</b> · ~${mins} min`;
  }
  return `\n   ↳ próximo: <b>${name}</b>`;
}

function formatStatus(state) {
  if (!state) {
    return ' <b>Sem dados do worker</b>\nInicie com <code>node src/bot.js</code> e tente <code>/wa_status</code>.';
  }

  const conn = state.connected ? ' Conectado' : ' Desconectado';
  const phone = state.phone ? `\n <code>${state.phone}</code>` : '';
  const maxG = state.maxGroupsEffective ?? state.maxGroups ?? '?';
  const groups = `\n Grupos: <b>${state.activeGroups ?? 0}/${maxG}</b>`;
  const profile = `\n Perfil: <code>${state.profile || 'safe'}</code>${state.autoProfile === false ? ' (manual)' : ' (auto)'}`;
  const risk =
    state.spamRiskScore != null
      ? `\n Risco spam: <b>${state.spamRiskScore}</b>/100${state.spamRiskReasons?.length ? `\n   ↳ ${state.spamRiskReasons[0]}` : ''}`
      : '';
  const paused = state.postsPaused || state.paused ? '\n⏸ Postagens pausadas' : '';
  const joinLines = formatJoinStatusLines(state);
  const promoQ =
    state.promoQueue > 0
      ? `\n Fila promo: <b>${state.promoQueue}</b>${formatPromoNextLine(state.promoNext)}`
      : '';
  const hanorkRot =
    state.hanorkCampaignEnabled === false ? '\n Campanha hanork OFF na rotação' : '';
  const hanorkSync =
    state.hanorkAutoSyncCount > 0
      ? `\n Divulgação auto Hanork → WA: <b>${state.hanorkAutoSyncCount}</b> produto(s)`
      : state.hanorkAutoSyncEnabled === false
        ? '\n Sync catálogo Hanork OFF (textos estáticos mensagens.json)'
        : '';
  const lastPost = state.lastPostAt
    ? `\n Último post: ${new Date(state.lastPostAt).toLocaleString('pt-BR')}`
    : '';
  const worker =
    state.ipcOnline !== false ? '' : '\n IPC offline (worker parado?)';

  return ` <b>WhatsApp (Zero Divu)</b>\n\n${conn}${phone}${groups}${profile}${risk}${paused}${joinLines}${promoQ}${hanorkRot}${hanorkSync}${lastPost}${worker}`;
}

function formatStatusStats(data) {
  if (!data || data.ok === false) {
    return ` <b>Stats indisponíveis</b>\n${data?.message || 'Worker offline ou sem dados.'}`;
  }

  const lines = [];
  lines.push(' <b>Status WA — controle diário</b>\n');
  lines.push(
    ` Dia: <code>${data.day}</code> · máx <b>${data.maxPerDay}</b>/grupo · intervalo <b>${data.minIntervalHours}h</b>`
  );
  lines.push(
    ` Grupos: <b>${data.totals?.tracked ?? 0}</b> ·  ${data.totals?.canPost ?? 0} · ⏳ ${data.totals?.onCooldown ?? 0} ·  ${data.totals?.atLimit ?? 0}`
  );
  if (data.antiBan?.hardPaused) {
    lines.push(
      ` Anti-ban: <b>PAUSA</b> ~${data.antiBan.remainingMin} min · risco ${data.antiBan.riskScore}/100`
    );
    lines.push('<code>/wa_anti_ban_reset</code> libera se a conexão já está estável');
  }
  if (data.filter) {
    lines.push(` Filtro: <code>${data.filter}</code>`);
  }

  const groups = data.groups || [];
  if (groups.length) {
    lines.push('\n<b>Por grupo</b>');
    for (const g of groups.slice(0, 15)) {
      const name = String(g.subject || g.shortId || '?').slice(0, 28);
      lines.push(
        `• <code>${g.shortId}</code> ${name}\n` +
          `  ${g.postsToday}/${g.maxPerDay} hoje · ${g.stateLabel} · último ${g.lastPostLabel}`
      );
    }
    if (groups.length > 15) {
      lines.push(`… +${groups.length - 15} (use filtro: <code>/wa_status_stats ID</code>)`);
    }
  } else {
    lines.push('\n<i>Nenhum grupo no filtro.</i>');
  }

  const hashes = data.recentHashes || [];
  if (hashes.length) {
    lines.push('\n<b>Hashes recentes (24h)</b>');
    for (const h of hashes.slice(0, 8)) {
      lines.push(
        `• <code>${String(h.hash).slice(0, 12)}…</code> prod=${h.productId ?? '-'} gp=${h.groupShort || '?'} · ${h.atLabel}`
      );
    }
  }

  const products = data.productLastPosted || [];
  if (products.length) {
    lines.push('\n<b>Última divulgação por produto</b>');
    for (const p of products.slice(0, 8)) {
      lines.push(`• prod <code>${p.productId}</code> · ${p.atLabel}`);
    }
  }

  lines.push('\n<code>/wa_status_stats</code> · <code>/wa_status_stats ID_GRUPO</code>');
  return lines.join('\n');
}

function offlineMsg(ack) {
  return offlineMessage(ack);
}

function registerZeroDivuCommands(bot, { isAdmin, Msg, logger, deferBackground, syncHanorkCatalog }) {
  const login = require('./ZeroDivuLoginService').getZeroDivuLoginService();
  const client = getZeroDivuClient();

  const guard = (ctx) => {
    if (!isAdmin(ctx.from?.id)) {
      Msg.reply(ctx, ' Acesso negado.');
      return false;
    }
    if (ctx.chat?.type !== 'private') {
      Msg.reply(ctx, ' Comandos <code>/wa_*</code> só no PV com o bot.', { parse_mode: 'HTML' });
      return false;
    }
    return true;
  };

  const runWa = createRunWa({ guard, Msg, logger, deferBackground, client });

  bot.command('wa_status', runWa('/wa_status', async (ctx) => {
    const { state, stale } = await refreshWorkerState(client, ctx.from.id);
    await Msg.reply(ctx, `${formatStatus(state)}${staleStateBanner(stale)}`, { parse_mode: 'HTML' });
  }));

  bot.command('wa_conectar', runWa('/wa_conectar', async (ctx) => {
    const r = await login.startLogin(ctx.from.id, ctx);
    await Msg.reply(ctx, r.message, { parse_mode: 'HTML' });
  }));

  bot.command('wa_pair', runWa('/wa_pair', async (ctx) => {
    const phone = parseWaArgs(ctx, 'wa_pair');
    if (!phone) {
      await Msg.reply(
        ctx,
        'Uso: <code>/wa_pair 5511999999999</code>\n\n' +
          'DDI + DDD + número (só dígitos). Alternativa ao QR.\n' +
          'No celular: Aparelhos conectados → Conectar com número.',
        { parse_mode: 'HTML' }
      );
      return;
    }
    const r = await login.startPairing(ctx.from.id, ctx, phone);
    await Msg.reply(ctx, r.message, { parse_mode: 'HTML' });
  }));

  bot.command('wa_novo_qr', runWa('/wa_novo_qr', async (ctx) => {
    const r = await login.refreshQr(ctx.from.id, ctx);
    await Msg.reply(ctx, r.message, { parse_mode: 'HTML' });
  }));

  bot.command('wa_preset_prod', runWa('/wa_preset_prod', async (ctx) => {
    const ack = await mutateWa(client, 'wa.preset_prod', {}, ctx.from.id);
    if (!ack.ok) {
      await Msg.reply(ctx, ` ${offlineMsg(ack)}`, { parse_mode: 'HTML' });
      return;
    }
    await Msg.reply(
      ctx,
      ' <b>Preset produção segura aplicado</b>\n\n' +
        '- Perfil: <code>safe</code> (manual)\n' +
        '- Auto-join: <code>ON</code> · Post ao entrar: <code>ON</code>\n' +
        '- Min membros: <code>50</code> · Joins/h: <code>2</code>\n' +
        '- Anti-spam: delays, fila promo, sync Hanork\n\n' +
        'Use <code>/wa_limites</code> para conferir.',
      { parse_mode: 'HTML' }
    );
  }));

  bot.command('wa_min_membros', runWa('/wa_min_membros', async (ctx) => {
    const n = parseWaArgs(ctx, 'wa_min_membros');
    const val = Number(String(n).trim());
    if (!Number.isFinite(val)) {
      await Msg.reply(ctx, 'Uso: <code>/wa_min_membros 50</code>', { parse_mode: 'HTML' });
      return;
    }
    const ack = await mutateWa(client, 'wa.set_min_members', { n: val }, ctx.from.id);
    await Msg.reply(
      ctx,
      ack.ok ? ` Min membros: <code>${ack.result?.minMembers ?? val}</code>` : ` ${offlineMsg(ack)}`,
      { parse_mode: 'HTML' }
    );
  }));

  bot.command('wa_auto_join', runWa('/wa_auto_join', async (ctx) => {
    const arg = parseWaArgs(ctx, 'wa_auto_join').toLowerCase();
    if (arg !== 'on' && arg !== 'off') {
      await Msg.reply(ctx, 'Uso: <code>/wa_auto_join on</code> | <code>/wa_auto_join off</code>', {
        parse_mode: 'HTML',
      });
      return;
    }
    const ack = await mutateWa(client, 'wa.set_auto_join', { on: arg }, ctx.from.id);
    await Msg.reply(
      ctx,
      ack.ok
        ? ` Auto-join: <code>${ack.result?.autoJoinGroups ? 'ON' : 'OFF'}</code>`
        : ` ${offlineMsg(ack)}`,
      { parse_mode: 'HTML' }
    );
  }));

  bot.command('wa_auto_post_entrar', runWa('/wa_auto_post_entrar', async (ctx) => {
    const arg = parseWaArgs(ctx, 'wa_auto_post_entrar').toLowerCase();
    if (arg !== 'on' && arg !== 'off') {
      await Msg.reply(
        ctx,
        'Uso: <code>/wa_auto_post_entrar on</code> | <code>/wa_auto_post_entrar off</code>',
        { parse_mode: 'HTML' }
      );
      return;
    }
    const ack = await mutateWa(client, 'wa.set_auto_post_on_join', { on: arg }, ctx.from.id);
    await Msg.reply(
      ctx,
      ack.ok
        ? ` Auto-post ao entrar: <code>${ack.result?.autoPostOnJoin ? 'ON' : 'OFF'}</code>`
        : ` ${offlineMsg(ack)}`,
      { parse_mode: 'HTML' }
    );
  }));

  bot.command('wa_max_joins_h', runWa('/wa_max_joins_h', async (ctx) => {
    const n = parseWaArgs(ctx, 'wa_max_joins_h');
    const val = Number(String(n).trim());
    if (!Number.isFinite(val)) {
      await Msg.reply(ctx, 'Uso: <code>/wa_max_joins_h 2</code>', { parse_mode: 'HTML' });
      return;
    }
    const ack = await mutateWa(client, 'wa.set_max_join_per_hour', { n: val }, ctx.from.id);
    await Msg.reply(
      ctx,
      ack.ok ? ` Joins/h: <code>${ack.result?.maxJoinPerHour ?? val}</code>` : ` ${offlineMsg(ack)}`,
      { parse_mode: 'HTML' }
    );
  }));

  bot.command('wa_anti_ban_reset', runWa('/wa_anti_ban_reset', async (ctx) => {
    const ack = await sendWaCommand(client, 'wa.clear_antiban_pause', {}, ctx.from.id, {
      requireOnline: true,
    });
    const p = ack?.result || {};
    if (!ack?.ok) {
      await Msg.reply(ctx, ` ${offlineMsg(ack)}`, { parse_mode: 'HTML' });
      return;
    }
    await Msg.reply(
      ctx,
      ` <b>Anti-ban liberado</b>\nRisco: <code>${p.riskScore ?? '?'}</code>/100\n\n` +
        'A rotação automática retoma nos próximos ciclos. Promo Hanork na fila continua com prioridade.',
      { parse_mode: 'HTML' }
    );
  }));

  bot.command('wa_status_stats', runWa('/wa_status_stats', async (ctx) => {
    const filter = parseWaArgs(ctx, 'wa_status_stats');
    const ack = await sendWaCommand(
      client,
      'wa.get_status_stats',
      { group: filter || undefined, limit: 20 },
      ctx.from.id,
      { requireOnline: true }
    );
    const data = ack?.ok ? ack.result || ack.result?.result : { ok: false, message: offlineMsg(ack) };
    await Msg.reply(ctx, formatStatusStats(data), { parse_mode: 'HTML' });
  }));

  bot.command('wa_limites', runWa('/wa_limites', async (ctx) => {
    const ack = await sendWaCommand(client, 'wa.get_limits', {}, ctx.from.id, { requireOnline: true });
    if (!ack.ok) {
      await Msg.reply(ctx, formatLimitsText(null, { offline: true }), { parse_mode: 'HTML' });
      return;
    }
    await Msg.reply(ctx, formatLimitsText(ack.result || {}), { parse_mode: 'HTML' });
  }));

  bot.command('wa_desconectar', runWa('/wa_desconectar', async (ctx) => {
    const arg = parseWaArgs(ctx, 'wa_desconectar').toLowerCase();
    if (arg !== 'sim' && arg !== 'confirm') {
      await Msg.reply(
        ctx,
        ' <b>Logout WhatsApp</b>\n\n' +
          'Isso encerra a sessão Baileys e exige novo QR.\n\n' +
          'Confirme: <code>/wa_desconectar sim</code>',
        { parse_mode: 'HTML' }
      );
      return;
    }
    const ack = await mutateWa(client, 'wa.logout', {}, ctx.from.id);
    await Msg.reply(
      ctx,
      ack.ok
        ? ' Sessão WhatsApp encerrada. Use <code>/wa_conectar</code> para novo QR.'
        : ` ${offlineMsg(ack)}`,
      { parse_mode: 'HTML' }
    );
  }));

  bot.command('wa_logs', runWa('/wa_logs', async (ctx) => {
    const waLogSettings = require('./waLogSettings');
    const parts = parseWaArgs(ctx, 'wa_logs').split(/\s+/).filter(Boolean);
    if (!parts.length) {
      const cfg = waLogSettings.get();
      await Msg.reply(
        ctx,
        ` Logs WA no Telegram: <b>${cfg.enabled ? 'ON' : 'OFF'}</b>\n` +
          `Nível: <code>${cfg.level || 'info'}</code>\n\n` +
          '<code>/wa_logs on</code> · <code>/wa_logs off</code>\n' +
          '<code>/wa_logs nivel warn</code>',
        { parse_mode: 'HTML' }
      );
      return;
    }
    if (parts[0] === 'nivel' && parts[1]) {
      const level = parts[1].toLowerCase() === 'warn' ? 'warn' : 'info';
      const cfg = waLogSettings.get();
      waLogSettings.setEnabled(ctx.from.id, cfg.enabled, level);
      await Msg.reply(ctx, ` Filtro logs WA: <code>${level}</code>`, { parse_mode: 'HTML' });
      return;
    }
    const on = parts[0].toLowerCase();
    if (on === 'on' || on === 'off') {
      waLogSettings.setEnabled(ctx.from.id, on === 'on');
      await Msg.reply(
        ctx,
        on === 'on'
          ? ' Eventos WA serão espelhados neste PV (resumidos).'
          : ' Espelhamento WA desligado.',
        { parse_mode: 'HTML' }
      );
      return;
    }
    await Msg.reply(ctx, 'Uso: <code>/wa_logs on</code> | <code>/wa_logs off</code> | <code>/wa_logs nivel warn</code>', {
      parse_mode: 'HTML',
    });
  }));

  bot.command('wa_audit', runWa('/wa_audit', async (ctx) => {
    const { recent, formatAuditLines } = require('./WaAdminAudit');
    const rows = recent(20);
    await Msg.reply(ctx, ` <b>Auditoria WA (últimos 20)</b>\n\n${formatAuditLines(rows)}`, {
      parse_mode: 'HTML',
    });
  }));

  bot.command('wa_sync_catalog', runWa('/wa_sync_catalog', async (ctx) => {
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
        ` ${r?.error === 'no_active_products' ? 'Nenhum produto ativo no catálogo.' : r?.error || 'Falha ao sincronizar'}`,
        { parse_mode: 'HTML' }
      );
      return;
    }
    await refreshWorkerState(client, ctx.from.id);
    const asyncNote = r.asyncAi
      ? '\n\n Textos IA serão gerados em background (fila <code>ai:catalog</code>, ~30s/produto).'
      : '';
    await Msg.reply(
      ctx,
      (r.asyncAi && r.queued
        ? ` Catálogo enfileirado (IA async)\n\nJob <code>${r.jobId || 'ai:catalog'}</code> — template primeiro, depois textos IA.`
        : ` Catálogo Hanork → WhatsApp sincronizado\n\n` +
          ` <b>${r.count}</b> produto(s) — mesmos textos da divulgação automática Telegram`) +
        asyncNote +
        '\n\nCampanha <code>hanork</code> na rotação WA usa estes textos + fotos dos produtos.',
      { parse_mode: 'HTML' }
    );
  }));

  bot.command('wa_ligar', runWa('/wa_ligar', async (ctx) => {
    const ack = await mutateWa(client, 'wa.resume', {}, ctx.from.id);
    await Msg.reply(
      ctx,
      ack.ok ? '▶ Postagens automáticas <b>ligadas</b>.' : ` ${offlineMsg(ack)}`,
      { parse_mode: 'HTML' }
    );
  }));

  bot.command('wa_pausar', runWa('/wa_pausar', async (ctx) => {
    const ack = await mutateWa(client, 'wa.pause', {}, ctx.from.id);
    await Msg.reply(
      ctx,
      ack.ok ? '⏸ Postagens automáticas <b>pausadas</b>.' : ` ${offlineMsg(ack)}`,
      { parse_mode: 'HTML' }
    );
  }));

  bot.command('wa_postar', runWa('/wa_postar', async (ctx) => {
    const ack = await mutateWa(client, 'wa.post_now', {}, ctx.from.id);
    await Msg.reply(ctx, waPostFeedback.formatPostNowReply(ack), { parse_mode: 'HTML' });
  }));

  bot.command('wa_postar_campanha', runWa('/wa_postar_campanha', async (ctx) => {
    const name = parseWaArgs(ctx, 'wa_postar_campanha');
    if (!name) {
      await Msg.reply(ctx, 'Uso: <code>/wa_postar_campanha hanork</code> (próximo produto do catálogo)', {
        parse_mode: 'HTML',
      });
      return;
    }
    const ack = await mutateWa(client, 'wa.post_now', { campaign: name }, ctx.from.id);
    await Msg.reply(ctx, waPostFeedback.formatPostNowReply(ack), { parse_mode: 'HTML' });
  }));

  bot.command('wa_sync', runWa('/wa_sync', async (ctx) => {
    const ack = await mutateWa(client, 'wa.sync_groups', {}, ctx.from.id);
    if (!ack.ok) {
      await Msg.reply(ctx, ` ${offlineMsg(ack)}`, { parse_mode: 'HTML' });
      return;
    }
    const n = ack.result?.activeGroups ?? ack.result?.result?.activeGroups ?? '?';
    await Msg.reply(ctx, ` Sincronizado — <b>${n}</b> grupos ativos no JSON.`, {
      parse_mode: 'HTML',
    });
  }));

  bot.command('wa_max', runWa('/wa_max', async (ctx) => {
    const raw = parseWaArgs(ctx, 'wa_max');
    const n = parseInt(raw, 10);
    if (!n || n < 1) {
      await Msg.reply(ctx, 'Uso: <code>/wa_max 40</code>', { parse_mode: 'HTML' });
      return;
    }
    const ack = await mutateWa(client, 'wa.set_max', { n, max: n }, ctx.from.id);
    if (!ack.ok) {
      await Msg.reply(ctx, ` ${offlineMsg(ack)}`, { parse_mode: 'HTML' });
      return;
    }
    const configured = ack.result?.maxGroups ?? n;
    const effective = ack.result?.maxGroupsEffective ?? configured;
    const { state: st } = await refreshWorkerState(client, ctx.from.id);
    const active = st?.activeGroups ?? '?';
    const cap = effective;
    const room = typeof active === 'number' ? Math.max(0, cap - active) : '?';
    const warmNote =
      effective !== configured
        ? `\n Limite efetivo <b>${effective}</b> (warm-up; configurado ${configured})`
        : '';
    const safeNote =
      configured >= 32
        ? '\n Com 32+ grupos: joins/h, posts/h e delays sobem automaticamente (anti-ban).'
        : '';
    await Msg.reply(
      ctx,
      ` MAX_GROUPS = <b>${configured}</b>${warmNote}${safeNote}\n ${active}/${cap} · ainda cabem <b>${room}</b>`,
      { parse_mode: 'HTML' }
    );
  }));

  bot.command('wa_perfil', runWa('/wa_perfil', async (ctx) => {
    const name = parseWaArgs(ctx, 'wa_perfil').toLowerCase();
    if (!['safe', 'balanced', 'aggressive'].includes(name)) {
      await Msg.reply(ctx, 'Uso: <code>/wa_perfil safe</code> | <code>balanced</code> | <code>aggressive</code>', {
        parse_mode: 'HTML',
      });
      return;
    }
    const ack = await mutateWa(client, 'wa.set_profile', { profile: name }, ctx.from.id);
    await Msg.reply(
      ctx,
      ack.ok
        ? ` Perfil manual: <code>${ack.result?.profile || name}</code>\n<i>Auto perfil pausado — use /wa_auto on para voltar</i>`
        : ` ${offlineMsg(ack)}`,
      { parse_mode: 'HTML' }
    );
  }));

  bot.command('wa_auto', runWa('/wa_auto', async (ctx) => {
    const arg = parseWaArgs(ctx, 'wa_auto').toLowerCase();
    if (arg && !['on', 'off', 'status'].includes(arg)) {
      await Msg.reply(ctx, 'Uso: <code>/wa_auto on</code> | <code>off</code> | <code>status</code>', {
        parse_mode: 'HTML',
      });
      return;
    }
    const mode = arg || 'status';
    const ack =
      mode === 'status'
        ? await sendWaCommand(client, 'wa.auto_profile', {}, ctx.from.id, { requireOnline: true })
        : await mutateWa(
            client,
            'wa.auto_profile',
            mode === 'on' ? { on: true } : { off: true },
            ctx.from.id
          );
    if (!ack.ok) {
      await Msg.reply(ctx, ` ${offlineMsg(ack)}`, { parse_mode: 'HTML' });
      return;
    }
    const r = ack.result || {};
    if (mode === 'status' || (!arg && r.enabled != null)) {
      const lines = [
        r.enabled ? ' Perfil automático <b>ligado</b>' : ' Perfil automático <b>desligado</b>',
        `Perfil atual: <code>${r.profile || '?'}</code>`,
        r.riskScore != null ? `Risco spam: <b>${r.riskScore}</b>/100` : null,
        r.reasons?.length ? `↳ ${r.reasons.slice(0, 2).join(' · ')}` : null,
        r.enabled && r.profile === 'safe' && r.lowRiskStreak != null
          ? `Subida automática: <b>${r.lowRiskStreak}/${r.upgradeStreakNeed ?? 4}</b> ciclos estáveis → balanced`
          : null,
        r.enabled
          ? '\n<i>Ajusta safe → balanced → aggressive conforme falhas, cotas e padrões.</i>'
          : null,
      ].filter(Boolean);
      await Msg.reply(ctx, lines.join('\n'), { parse_mode: 'HTML' });
      return;
    }
    await Msg.reply(
      ctx,
      r.autoProfile !== false
        ? ` Perfil automático <b>ligado</b>${r.profile ? ` · atual: <code>${r.profile}</code>` : ''}`
        : ' Perfil automático <b>desligado</b> — use /wa_perfil para fixar manualmente',
      { parse_mode: 'HTML' }
    );
  }));

  bot.command('wa_delay', runWa('/wa_delay', async (ctx) => {
    const parts = parseWaArgs(ctx, 'wa_delay').split(/\s+/);
    const kind = (parts[0] || 'post').toLowerCase();
    const ms = parseInt(parts[1], 10);
    if (!ms || ms < 1000) {
      await Msg.reply(
        ctx,
        'Uso: <code>/wa_delay post 15000</code> · <code>/wa_delay join 60000</code> · <code>/wa_delay status 90000</code>',
        { parse_mode: 'HTML' }
      );
      return;
    }
    if (!['post', 'join', 'status'].includes(kind)) {
      await Msg.reply(ctx, 'Tipo: <code>post</code>, <code>join</code> ou <code>status</code>', {
        parse_mode: 'HTML',
      });
      return;
    }
    const ack = await sendWaCommand(client, 'wa.set_delay', { kind, ms }, ctx.from.id, {
      requireOnline: true,
    });
    await Msg.reply(
      ctx,
      ack.ok
        ? ` Delay <code>${kind}</code> = <b>${ack.result?.ms ?? ms}</b> ms (aplicado imediatamente)`
        : ` ${offlineMsg(ack)}`,
      { parse_mode: 'HTML' }
    );
  }));

  bot.command('wa_grupos', runWa('/wa_grupos', async (ctx) => {
    const ack = await sendWaCommand(client, 'wa.list_groups', { limit: 20 }, ctx.from.id, {
      requireOnline: true,
    });
    if (await replyIfAckFailed(Msg, ctx, ack, '')) return;
    const groups = ack.result?.groups || ack.result?.result?.groups || [];
    if (!groups.length) {
      await Msg.reply(ctx, ' Nenhum grupo ativo.', { parse_mode: 'HTML' });
      return;
    }
    const lines = groups
      .slice(0, 15)
      .map(
        (g, i) =>
          `${i + 1}. <b>${g.subject || g.shortId}</b> · score ${g.score ?? 0}\n   <code>${g.shortId}</code>`
      )
      .join('\n');
    await Msg.reply(ctx, ` <b>Grupos (${groups.length})</b>\n\n${lines}`, { parse_mode: 'HTML' });
  }));

  bot.command('wa_grupo', runWa('/wa_grupo', async (ctx) => {
    const args = parseWaArgs(ctx, 'wa_grupo').split(/\s+/);
    if ((args[0] || '').toLowerCase() !== 'sair' || !args[1]) {
      await Msg.reply(ctx, 'Uso: <code>/wa_grupo SAIR 55123456789-123@g.us</code> ou ID curto', {
        parse_mode: 'HTML',
      });
      return;
    }
    const ack = await mutateWa(client, 'wa.leave_group', { id: args.slice(1).join(' ') }, ctx.from.id);
    if (!ack.ok) {
      await Msg.reply(ctx, ` ${ack.message || offlineMsg(ack)}`, { parse_mode: 'HTML' });
      return;
    }
    const r = ack.result?.result || ack.result || {};
    await Msg.reply(ctx, ` Saiu de <b>${r.subject || r.id}</b>`, { parse_mode: 'HTML' });
  }));

  bot.command('wa_grupos_invalidos', runWa('/wa_grupos_invalidos', async (ctx) => {
    const ack = await sendWaCommand(client, 'wa.list_invalid', { limit: 20 }, ctx.from.id, {
      requireOnline: true,
    });
    if (await replyIfAckFailed(Msg, ctx, ack, '')) return;
    const groups = ack.result?.groups || ack.result?.result?.groups || [];
    if (!groups.length) {
      await Msg.reply(ctx, ' Nenhum grupo inválido registrado.', { parse_mode: 'HTML' });
      return;
    }
    const lines = groups
      .slice(0, 15)
      .map((g) => `• <code>${g.shortId}</code> — ${g.reason}`)
      .join('\n');
    await Msg.reply(ctx, ` <b>Grupos inválidos</b>\n\n${lines}`, { parse_mode: 'HTML' });
  }));

  bot.command('wa_campanha_hanork', runWa('/wa_campanha_hanork', async (ctx) => {
    const arg = parseWaArgs(ctx, 'wa_campanha_hanork').toLowerCase();
    if (!['on', 'off'].includes(arg)) {
      const st = await sendWaCommand(client, 'wa.get_hanork_campaign', {}, ctx.from.id, {
        requireOnline: true,
      });
      if (!st.ok) {
        await Msg.reply(ctx, ` ${offlineMsg(st)}`, { parse_mode: 'HTML' });
        return;
      }
      const on = st.result?.hanorkCampaignEnabled !== false;
      await Msg.reply(
        ctx,
        `Campanha <code>hanork</code> na rotação: <b>${on ? 'ON' : 'OFF'}</b>\n\n` +
          '<code>/wa_campanha_hanork on</code> · <code>/wa_campanha_hanork off</code>',
        { parse_mode: 'HTML' }
      );
      return;
    }
    const ack = await mutateWa(client, 'wa.set_hanork_campaign', { on: arg }, ctx.from.id);
    if (!ack.ok) {
      await Msg.reply(ctx, ` ${offlineMsg(ack)}`, { parse_mode: 'HTML' });
      return;
    }
    const on = ack.result?.hanorkCampaignEnabled ?? ack.result?.result?.hanorkCampaignEnabled;
    await Msg.reply(
      ctx,
      on !== false
        ? ' Campanha <code>hanork</code> incluída na rotação.'
        : '⏸ Campanha <code>hanork</code> excluída da rotação (só <code>zero</code> etc.).',
      { parse_mode: 'HTML' }
    );
  }));

  bot.command('wa_promo_fila', runWa('/wa_promo_fila', async (ctx) => {
    const ack = await sendWaCommand(client, 'wa.list_promo', {}, ctx.from.id, { requireOnline: true });
    if (await replyIfAckFailed(Msg, ctx, ack, '')) return;
    const jobs = ack.result?.jobs || ack.result?.result?.jobs || [];
    if (!jobs.length) {
      await Msg.reply(ctx, ' Fila promo vazia.', { parse_mode: 'HTML' });
      return;
    }
    const lines = jobs
      .map(
        (j) => {
          let line = `• <code>${j.id}</code> ${j.productName || 'promo'} · ${j.status}`;
          if (j.processAfter) {
            const mins = Math.max(0, Math.round((new Date(j.processAfter).getTime() - Date.now()) / 60000));
            line += mins > 0 ? ` · ~${mins} min` : ' · pronto';
          }
          return line + (j.hasImage ? ' ' : '');
        }
      )
      .join('\n');
    await Msg.reply(ctx, ` <b>Fila promo WA</b>\n\n${lines}\n\n<code>/wa_postar</code> processa o próximo elegível.`, { parse_mode: 'HTML' });
  }));

  bot.command('wa_help', runWa('/wa_help', async (ctx) => {
    const { buildWaHelpParts } = require('./waCommandsHelp');
    const parts = buildWaHelpParts('all');
    for (const text of parts) {
      await Msg.reply(ctx, text, { parse_mode: 'HTML', disable_web_page_preview: true });
    }
  }));

  bot.command('wa_retomar', runWa('/wa_retomar', async (ctx) => {
    const ack = await mutateWa(client, 'wa.resume', {}, ctx.from.id);
    await Msg.reply(
      ctx,
      ack.ok ? '▶ Postagens automáticas retomadas.' : ` ${offlineMsg(ack)}`,
      { parse_mode: 'HTML' }
    );
  }));

  bot.command('wa_auto_sync', runWa('/wa_auto_sync', async (ctx) => {
    const arg = parseWaArgs(ctx, 'wa_auto_sync').toLowerCase();
    if (arg && !['on', 'off', 'status'].includes(arg)) {
      await Msg.reply(ctx, 'Uso: <code>/wa_auto_sync on</code> | <code>off</code> | <code>status</code>', {
        parse_mode: 'HTML',
      });
      return;
    }
    if (!arg || arg === 'status') {
      const ack = await sendWaCommand(client, 'wa.get_hanork_campaign', {}, ctx.from.id, {
        requireOnline: true,
      });
      if (!ack.ok) {
        await Msg.reply(ctx, ` ${offlineMsg(ack)}`, { parse_mode: 'HTML' });
        return;
      }
      const on = ack.result?.hanorkAutoSyncEnabled !== false;
      const hint = arg
        ? ''
        : '\n\n<code>/wa_auto_sync on</code> · <code>/wa_auto_sync off</code>';
      await Msg.reply(ctx, `Sync catálogo Hanork → WA: <b>${on ? 'ON' : 'OFF'}</b>${hint}`, {
        parse_mode: 'HTML',
      });
      return;
    }
    const ack = await mutateWa(client, 'wa.set_hanork_auto_sync', { on: arg }, ctx.from.id);
    if (!ack.ok) {
      await Msg.reply(ctx, ` ${offlineMsg(ack)}`, { parse_mode: 'HTML' });
      return;
    }
    const on = ack.result?.hanorkAutoSyncEnabled ?? ack.result?.result?.hanorkAutoSyncEnabled;
    await Msg.reply(
      ctx,
      on !== false
        ? ' Sync automático Hanork → WA ligado.'
        : '⏸ Sync automático Hanork → WA desligado.',
      { parse_mode: 'HTML' }
    );
  }));
}

module.exports = { registerZeroDivuCommands, formatStatus, formatJoinStatusLines, formatStatusStats };
