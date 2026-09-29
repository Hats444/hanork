/**
 * Job: Notification
 * Notificações assíncronas (carrinho abandonado, lembretes, etc)
 */
const logger = require('../../../config/logger');
const { prisma } = require('../../../config/database-sqlite');
const { jobLogFields } = require('../jobLogContext');
const { correlationContext } = require('../../../infrastructure');
const { normalizeReplyMarkup } = require('../../../telegram/menus/twoColKeyboard');

async function processAbandonedCart(job) {
  const meta = jobLogFields(job, { queueName: 'notification:abandoned' });
  const start = Date.now();

  return correlationContext.runWithId(async () => {
    const { userId, telegramId, items, total } = job.data;
    logger.info('[NOTIFICATION:JOB] Abandoned cart', meta);

    const bot = global.botInstance;
    if (!bot) return { sent: false, reason: 'no_bot' };

    try {
      const alreadySent = await prisma.notification.wasSent(userId, 'abandoned_cart');
      if (alreadySent) {
        return { sent: false, reason: 'already_notified' };
      }

      const itemsText = items.map((i) => `• ${i.name} x${i.quantity}`).join('\n');

      await bot.telegram.sendMessage(
        telegramId,
        `🛒 <b>Seu carrinho está esperando!</b>\n\n` +
          `${itemsText}\n\n` +
          `💰 Total: <b>R$ ${total.toFixed(2)}</b>\n\n` +
          `Complete sua compra antes que os itens esgotem!`,
        {
          parse_mode: 'HTML',
          reply_markup: normalizeReplyMarkup({
            inline_keyboard: [
              [{ text: '🛒 Ver Carrinho', callback_data: 'cart' }],
              [{ text: '🏠 Menu', callback_data: 'home' }],
            ],
          }),
        }
      );

      await prisma.notification.markSent(userId, String(telegramId), 'abandoned_cart', null);

      logger.info('[NOTIFICATION:JOB] Abandoned cart sent', {
        ...meta,
        durationMs: Date.now() - start,
      });
      return { sent: true, userId };
    } catch (err) {
      logger.error('[NOTIFICATION:JOB] Abandoned cart failed', {
        ...meta,
        err: err.message,
        durationMs: Date.now() - start,
      });
      return { sent: false, error: err.message };
    }
  }, meta.userId ? `abandoned:${meta.userId}` : undefined);
}

async function processPixReminder(job) {
  const meta = jobLogFields(job, { queueName: 'notification:pix' });
  const start = Date.now();

  return correlationContext.runWithId(async () => {
    const { userId, telegramId, orderId, total } = job.data;
    const bot = global.botInstance;
    if (!bot) return { sent: false };

    try {
      const alreadySent = await prisma.notification.wasSent(userId, `pix_reminder_${orderId}`);
      if (alreadySent) return { sent: false, reason: 'already_sent' };

      await bot.telegram.sendMessage(
        telegramId,
        `⏰ <b>Seu PIX expira em breve!</b>\n\n` +
          `🔑 Pedido #${orderId.slice(-8)}\n` +
          `💰 R$ ${total.toFixed(2)}\n\n` +
          `Finalize seu pagamento para não perder seus produtos!`,
        { parse_mode: 'HTML' }
      );

      await prisma.notification.markSent(userId, String(telegramId), 'pix_reminder', orderId);

      logger.info('[NOTIFICATION:JOB] PIX reminder sent', {
        ...meta,
        durationMs: Date.now() - start,
      });
      return { sent: true };
    } catch (err) {
      logger.error('[NOTIFICATION:JOB] PIX reminder failed', {
        ...meta,
        err: err.message,
        durationMs: Date.now() - start,
      });
      return { sent: false, error: err.message };
    }
  }, meta.orderId ? `pix-reminder:${meta.orderId}` : undefined);
}

async function processGiveawayWinner(job) {
  const meta = jobLogFields(job, { queueName: 'notification:giveaway' });
  const start = Date.now();

  return correlationContext.runWithId(async () => {
    const { telegramId, giveawayName, prize, giveawayId } = job.data;
    const bot = global.botInstance;
    if (!bot) return { sent: false };

    try {
      await bot.telegram.sendMessage(
        parseInt(telegramId, 10),
        `🏆 <b>Parabéns, você ganhou!</b>\n\n` +
          `🎉 <b>${giveawayName}</b>\n` +
          `🎁 Prêmio: ${prize}\n\n` +
          `Entre em contato com o suporte para retirar seu prêmio.`,
        { parse_mode: 'HTML' }
      );

      logger.info('[NOTIFICATION:JOB] Giveaway winner sent', {
        ...meta,
        giveawayId,
        durationMs: Date.now() - start,
      });
      return { sent: true, giveawayId, telegramId };
    } catch (err) {
      logger.error('[NOTIFICATION:JOB] Giveaway failed', {
        ...meta,
        err: err.message,
        durationMs: Date.now() - start,
      });
      return { sent: false, error: err.message };
    }
  }, job.data?.giveawayId ? `giveaway:${job.data.giveawayId}` : undefined);
}

async function processSubscriptionReminder(job) {
  const meta = jobLogFields(job, { queueName: 'notification:subscription' });
  const start = Date.now();

  return correlationContext.runWithId(async () => {
    const { telegramId, planName, daysUntil, nextPaymentDate } = job.data;
    const bot = global.botInstance;
    if (!bot) return { sent: false };

    try {
      await bot.telegram.sendMessage(
        telegramId,
        `📅 <b>Sua assinatura vence em ${daysUntil} dias!</b>\n\n` +
          `Plano: ${planName}\n` +
          `Próximo pagamento: ${new Date(nextPaymentDate).toLocaleDateString('pt-BR')}\n\n` +
          `Renove agora para manter seus benefícios!`,
        { parse_mode: 'HTML' }
      );

      logger.info('[NOTIFICATION:JOB] Subscription reminder sent', {
        ...meta,
        durationMs: Date.now() - start,
      });
      return { sent: true };
    } catch (err) {
      logger.error('[NOTIFICATION:JOB] Subscription reminder failed', {
        ...meta,
        err: err.message,
        durationMs: Date.now() - start,
      });
      return { sent: false, error: err.message };
    }
  }, meta.telegramId ? `sub-reminder:${meta.telegramId}` : undefined);
}

async function processAdminNotify(job) {
  const meta = jobLogFields(job, { queueName: 'notification:admin' });
  const start = Date.now();
  const { adminId, text } = job.data || {};

  return correlationContext.runWithId(async () => {
    const notifier = global.adminActivityNotifier;
    if (!notifier) {
      logger.warn('[NOTIFICATION:JOB] Admin notify skipped — notifier offline', meta);
      return { sent: false, reason: 'no_notifier' };
    }
    if (!adminId || !text) {
      return { sent: false, reason: 'invalid_payload' };
    }

    try {
      const ok = await notifier.sendToAdmin(adminId, text, { via: job.data?.via || 'main' });
      logger.debug('[NOTIFICATION:JOB] Admin notify', {
        ...meta,
        adminId,
        sent: ok,
        durationMs: Date.now() - start,
      });
      return { sent: ok, adminId };
    } catch (err) {
      logger.error('[NOTIFICATION:JOB] Admin notify failed', {
        ...meta,
        adminId,
        err: err.message,
        durationMs: Date.now() - start,
      });
      return { sent: false, error: err.message };
    }
  }, adminId ? `admin-notify:${adminId}` : undefined);
}

module.exports = {
  processAbandonedCart,
  processPixReminder,
  processGiveawayWinner,
  processSubscriptionReminder,
  processAdminNotify,
};
