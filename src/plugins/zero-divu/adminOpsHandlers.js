'use strict';

const { denyCbSilent } = require('../../utils/silencedAccess');

const adminOpsDigest = require('../../services/adminOpsDigest');
const { toTwoCols } = require('../../telegram/menus/twoColKeyboard');

function opsStatusKeyboard(Markup) {
  return Markup.inlineKeyboard(
    toTwoCols([
      [{ text: '🔄 Atualizar', callback_data: 'a_ops_status' }],
      [
        { text: '💰 Saldo SMM', callback_data: 'a_ops_balance' },
        { text: '🔙 Painel WA', callback_data: 'a_wa_menu' },
      ],
      [{ text: '🏠 Menu', callback_data: 'menu:home' }],
    ])
  );
}

function registerAdminOpsHandlers(bot, deps) {
  const { isAdmin, editAdminPanel, Msg, Markup, logger } = deps;

  bot.action('a_ops_status', async (ctx) => {
    if (!isAdmin(ctx.from?.id)) {
      await denyCbSilent('admin_callback', ctx);
      return;
    }
    await ctx.answerCbQuery().catch(() => {});
    const text = adminOpsDigest.buildPanelText();
    const kb = opsStatusKeyboard(Markup);
    try {
      if (editAdminPanel && ctx.callbackQuery) {
        await editAdminPanel(ctx, text, kb);
      } else {
        await Msg.reply(ctx, text, kb, { parse_mode: 'HTML', useMenuPhoto: true });
      }
    } catch (e) {
      logger?.warn?.('[Ops] painel status:', e.message);
    }
  });

  bot.action('a_ops_balance', async (ctx) => {
    if (!isAdmin(ctx.from?.id)) {
      await denyCbSilent('admin_callback', ctx);
      return;
    }
    await ctx.answerCbQuery('Consultando…').catch(() => {});
    try {
      const {
        fetchUnifiedSupplierSnapshot,
        buildAllSuppliersHtml,
      } = require('../../services/unifiedSupplierBalance');
      const snapshot = await fetchUnifiedSupplierSnapshot();
      const text = snapshot.ok
        ? buildAllSuppliersHtml(snapshot.rows, { showOkHint: true })
        : '❌ Nenhum fornecedor respondeu. Tente de novo em alguns segundos.';
      const kb = Markup.inlineKeyboard(
        toTwoCols([
          [{ text: '🔄 Atualizar', callback_data: 'a_ops_balance' }],
          [{ text: '🛠 Status ops', callback_data: 'a_ops_status' }],
          [{ text: '🏠 Menu', callback_data: 'menu:home' }],
        ])
      );
      if (editAdminPanel && ctx.callbackQuery) {
        await editAdminPanel(ctx, text, kb);
      } else {
        await Msg.reply(ctx, text, kb, { parse_mode: 'HTML', useMenuPhoto: true });
      }
    } catch (e) {
      logger?.warn?.('[Ops] saldo:', e.message);
      await ctx.answerCbQuery('Erro ao consultar saldo', { show_alert: true }).catch(() => {});
    }
  });
}

module.exports = { registerAdminOpsHandlers, opsStatusKeyboard };
