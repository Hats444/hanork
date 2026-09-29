/**
 * Module: Notification Service
 * Notificações e lembretes
 */
const { prisma } = require('../../config/database-sqlite');
const logger = require('../../config/logger');

class NotificationService {
  /**
   * Envia notificação se ainda não enviada
   */
  async sendIfNotSent(userId, type, content, telegram) {
    try {
      const alreadySent = await prisma.notification.wasSent(userId, type);
      if (alreadySent) return false;

      // Enviar via Telegram
      if (telegram && content.chatId) {
        await telegram.sendMessage(content.chatId, content.text, content.options || {});
      }

      const telegramId = content?.chatId ? String(content.chatId) : null;
      await prisma.notification.markSent(userId, telegramId, type, null);
      return true;
    } catch (e) {
      logger.error(`[NOTIFY] Erro: ${e.message}`);
      return false;
    }
  }

  /**
   * Notificação de carrinho abandonado
   */
  async abandonedCart(userId, telegramId, items, telegram) {
    const content = {
      chatId: telegramId,
      text: `🛒 Você deixou itens no carrinho!\n\n${items.map(i => `• ${i.name}`).join('\n')}\n\nFinalize sua compra!`,
      options: { parse_mode: 'HTML' }
    };
    return this.sendIfNotSent(userId, 'abandoned_cart', content, telegram);
  }

  /**
   * Notificação de pagamento pendente
   */
  async pendingPayment(userId, telegramId, orderId, amount, telegram) {
    const content = {
      chatId: telegramId,
      text: `⏰ Pagamento pendente #${orderId.slice(-8)}\n💰 R$ ${amount.toFixed(2)}\n\nFinalize para receber seus produtos!`,
      options: { parse_mode: 'HTML' }
    };
    return this.sendIfNotSent(userId, `pending_payment_${orderId}`, content, telegram);
  }

  /**
   * Notificação de produto entregue
   */
  async delivered(userId, telegramId, orderId, telegram) {
    const content = {
      chatId: telegramId,
      text: `✅ Pedido #${orderId.slice(-8)} entregue!\n\nConfira seus produtos na seção "Meus Pedidos"`,
      options: { parse_mode: 'HTML' }
    };
    return this.sendIfNotSent(userId, `delivered_${orderId}`, content, telegram);
  }

  /**
   * Notificação de reembolso
   */
  async refund(userId, telegramId, orderId, amount, method, telegram) {
    try {
      await telegram.sendMessage(telegramId,
        `♻️ Pedido #${orderId.slice(-8)} reembolsado\n💰 R$ ${amount.toFixed(2)}\n\nProcessado via ${method || 'método original'} em até 5 dias úteis.`,
        { parse_mode: 'HTML' }
      );
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Limpa notificações antigas
   */
  async cleanup(days = 30) {
    try {
      return prisma.notification?.cleanup?.(days) || 0;
    } catch (e) {
      return 0;
    }
  }
}

module.exports = new NotificationService();
