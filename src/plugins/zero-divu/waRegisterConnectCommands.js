'use strict';

const { Markup } = require('telegraf');
const { getZeroDivuClient } = require('./ZeroDivuClient');
const { resolveSession, DEFAULT_PRIMARY, DEFAULT_SECONDARY } = require('./waSessionsManifest');
const {
  offlineMessage,
  mutateWa,
  createRunWa,
  replyWaText,
  isWorkerOnline,
  refreshWorkerState,
  staleStateBanner,
} = require('./waIpcHelper');
const { parseWaArgs } = require('./waCommandParse');
const { replyWaAccessDenied } = require('./waUserAccessReply');
const { formatStatus, buildConnectChoiceKeyboardForSession } = require('./ZeroDivuCommands');

function offlineMsg(ack) {
  return offlineMessage(ack);
}

function registerWaSessionConnectCommands(bot, deps) {
  const { sessionId, isAdmin, Msg, logger, deferBackground, login } = deps;
  const conf = resolveSession(sessionId);
  const cmd = conf.cmdPrefix;
  const client = getZeroDivuClient(sessionId);

  const guard = (ctx) => {
    if (!isAdmin(ctx.from?.id)) {
      replyWaAccessDenied(Msg, ctx).catch(() => {});
      return false;
    }
    if (ctx.chat?.type !== 'private') {
      replyWaText(Msg, ctx, `📱 Comandos <code>/${cmd}_*</code> só no PV.`).catch(() => {});
      return false;
    }
    return true;
  };

  const runWa = createRunWa({ guard, Msg, logger, deferBackground, client });

  bot.command(`${cmd}_status`, runWa(`/${cmd}_status`, async (ctx) => {
    const { state, stale } = await refreshWorkerState(client, ctx.from.id);
    await Msg.reply(
      ctx,
      `${formatStatus(state, { label: conf.displayName || conf.label })}${staleStateBanner(stale)}`,
      { parse_mode: 'HTML' }
    );
  }));

  bot.command(`${cmd}_conectar`, runWa(`/${cmd}_conectar`, async (ctx) => {
    const r = await login.showConnectChoice(ctx.from.id, ctx, sessionId);
    if (r.choose) {
      await replyWaText(Msg, ctx, r.message, buildConnectChoiceKeyboardForSession(sessionId));
      return;
    }
    await replyWaText(Msg, ctx, r.message);
  }));

  const pairHandler = runWa(`/${cmd}_pair`, async (ctx) => {
    const phone = parseWaArgs(ctx, `${cmd}_pair`);
    if (!phone) {
      await replyWaText(
        Msg,
        ctx,
        `Uso: <code>/${cmd}_pair 5511999999999</code>\n\n` +
          'DDI + DDD + número (só dígitos). Alternativa ao QR.\n' +
          'O código chega <b>aqui no Telegram</b> — você digita no app WhatsApp.'
      );
      return;
    }
    if (!isWorkerOnline(client)) {
      await replyWaText(
        Msg,
        ctx,
        `⚠️ <b>Worker ${conf.label} ainda iniciando</b>\n\n` +
          'Aguarde ~2 min após o boot.\n' +
          `Depois repita: <code>/${cmd}_pair ${phone}</code>`
      );
      return;
    }
    await replyWaText(Msg, ctx, '⏳ Gerando código de pareamento…');
    const r = await login.startPairing(ctx.from.id, ctx, phone, sessionId);
    await replyWaText(Msg, ctx, r.message);
  });

  bot.command(`${cmd}_pair`, pairHandler);
  if (cmd === 'wa2') {
    bot.command('wa_pair2', pairHandler);
  }

  bot.command(`${cmd}_novo_qr`, runWa(`/${cmd}_novo_qr`, async (ctx) => {
    const r = await login.refreshQr(ctx.from.id, ctx, sessionId);
    await replyWaText(Msg, ctx, r.message);
  }));

  bot.command(`${cmd}_desconectar`, runWa(`/${cmd}_desconectar`, async (ctx) => {
    const arg = parseWaArgs(ctx, `${cmd}_desconectar`).toLowerCase();
    if (arg !== 'sim' && arg !== 'confirm') {
      await Msg.reply(
        ctx,
        `⚠️ <b>Logout — ${conf.label}</b>\n\n` +
          'Isso encerra a sessão Baileys e exige novo login.\n\n' +
          `Confirme: <code>/${cmd}_desconectar sim</code>`,
        { parse_mode: 'HTML' }
      );
      return;
    }
    const ack = await mutateWa(client, 'wa.logout', {}, ctx.from.id);
    await Msg.reply(
      ctx,
      ack.ok
        ? `🔓 Sessão encerrada (${conf.label}). Use <code>/${cmd}_conectar</code> para novo login.`
        : `❌ ${offlineMsg(ack)}`,
      { parse_mode: 'HTML' }
    );
  }));

  if (cmd === 'wa2') {
    bot.command('wa2_auto_join', runWa('/wa2_auto_join', async (ctx) => {
      const arg = parseWaArgs(ctx, 'wa2_auto_join').toLowerCase();
      if (arg !== 'on' && arg !== 'off') {
        await replyWaText(
          Msg,
          ctx,
          'Uso: <code>/wa2_auto_join on</code> | <code>/wa2_auto_join off</code>'
        );
        return;
      }
      const ack = await mutateWa(client, 'wa.set_auto_join', { on: arg }, ctx.from.id);
      await replyWaText(
        Msg,
        ctx,
        ack.ok
          ? `✅ Auto-join B: <code>${ack.result?.autoJoinGroups ? 'ON' : 'OFF'}</code>`
          : `❌ ${offlineMsg(ack)}`
      );
    }));

    bot.command('wa2_seed_joins', runWa('/wa2_seed_joins', async (ctx) => {
      const waA = getZeroDivuClient(DEFAULT_PRIMARY);
      const limitArg = parseWaArgs(ctx, 'wa2_seed_joins');
      const limit = Math.max(1, Number(limitArg) || 25);
      const ack = await mutateWa(waA, 'wa.forward_pending_invites', { limit }, ctx.from.id);
      if (!ack.ok) {
        await replyWaText(Msg, ctx, `❌ ${offlineMsg(ack)}`);
        return;
      }
      const r = ack.result || {};
      await replyWaText(
        Msg,
        ctx,
        `✅ Convites encaminhados → wa_b: <code>${r.forwarded ?? 0}</code> / ${r.total ?? '?'}`
      );
    }));
  }
}

function registerDualWaConnectCommands(bot, deps) {
  registerWaSessionConnectCommands(bot, { ...deps, sessionId: DEFAULT_SECONDARY });
}

module.exports = { registerWaSessionConnectCommands, registerDualWaConnectCommands };
