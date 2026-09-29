/**
 * Module: Delivery Service
 * Entrega de produtos digitais
 */
const CustomerSubscriptionService = require('../../modules/subscription/CustomerSubscriptionService');
const { prisma } = require('../../config/database-sqlite');
const logger = require('../../config/logger');
const { sleep, DELIVERY_GAP_MS } = require('./DeliveryMessaging');

class DeliveryService {
  /**
   * Entrega produtos ao usuário (sem cabeçalho/resumo — orquestrado pelo SafeDeliveryService)
   * @param {object} options - { resend: boolean }
   */
  async deliver(telegram, chatId, items, options = {}) {
    const results = [];
    const { subscriptionItems, regularItems } =
      await CustomerSubscriptionService.partitionDeliveryItems(items);

    // Produtos digitais primeiro
    for (const item of regularItems) {
      const qty = Math.max(1, Number(item.quantity) || 1);
      for (let unit = 0; unit < qty; unit++) {
        try {
          const success = await this._deliverItem(telegram, chatId, item, options);
          results.push({
            productId: item.product_id,
            name: item.name,
            success,
            unit: unit + 1,
            quantity: qty,
          });
        } catch (e) {
          results.push({
            productId: item.product_id,
            name: item.name,
            success: false,
            error: e.message,
            unit: unit + 1,
            quantity: qty,
          });
        }
        if (!options.resend) await sleep(DELIVERY_GAP_MS);
      }
    }

    // Assinaturas por último (mensagem própria do plano)
    if (subscriptionItems.length) {
      const user = await prisma.user.findUnique({ where: { telegram_id: String(chatId) } });
      const {
        activateWaDivulgacaoFromDelivery,
        shouldHandleSubscriptionItem,
      } = require('../wa-divulgacao/waDivulgacaoDelivery');

      for (const subItem of subscriptionItems) {
        try {
          if (user) {
            const product = subItem.product_id
              ? await prisma.product.findUnique({ where: { id: subItem.product_id } })
              : null;

            if (shouldHandleSubscriptionItem(subItem, product)) {
              await activateWaDivulgacaoFromDelivery(telegram, chatId, subItem);
            } else {
              await CustomerSubscriptionService.activateOrRenew({
                userId: user.id,
                telegramId: chatId,
                planName: subItem.name || 'Premium',
                planPrice: subItem.price || 29.9,
                telegram,
              });
            }
            try {
              const { trackConversionEvent } = require('../../services/ConversionEventService');
              trackConversionEvent(user.id, 'subscription_activated', {
                plan: subItem.name,
                product_id: subItem.product_id || null,
              });
            } catch (_) { /* telemetry */ }
          }
          results.push({
            productId: subItem.product_id || null,
            name: subItem.name,
            success: true,
            type: 'subscription',
          });
        } catch (e) {
          logger.error(`[DELIVERY] Assinatura falhou ${subItem.name}: ${e.message}`);
          results.push({
            productId: subItem.product_id || null,
            name: subItem.name,
            success: false,
            error: e.message,
            type: 'subscription',
          });
        }
        if (!options.resend) await sleep(DELIVERY_GAP_MS);
      }
    }

    return results;
  }

  async _deliverItem(telegram, chatId, item, options = {}) {
    const path = require('path');
    const { resolveLocalFile, isRemoteDocumentRef } = require('../../utils/safeLocalPath');
    const productsDir = process.env.PRODUCTS_PATH || path.join(__dirname, '../../../produtos');

    const product = item.product_id
      ? await prisma.product.findUnique({ where: { id: item.product_id } })
      : null;
    const ref = item.file_url || product?.file_url || '';
    const name = item.name || product?.name || 'Produto';
    const prefix = options.resend ? '🔄 Reenvio' : '📦';

    if (ref.startsWith('text:')) {
      await telegram.sendMessage(
        chatId,
        `${prefix} <b>${name}</b>\n\n${ref.slice(5)}`,
        { parse_mode: 'HTML' }
      );
      return true;
    }

    if (item.content) {
      await telegram.sendMessage(chatId, `${prefix} <b>${name}</b>\n\n${item.content}`, { parse_mode: 'HTML' });
      return true;
    }

    if (ref) {
      const localPath = resolveLocalFile(productsDir, ref);
      if (localPath) {
        await telegram.sendDocument(chatId, { source: localPath }, {
          caption: `${prefix} ${name}`,
          parse_mode: 'HTML',
        });
        return true;
      }
      if (isRemoteDocumentRef(ref)) {
        try {
          await telegram.sendDocument(chatId, ref, { caption: `${prefix} ${name}` });
          return true;
        } catch (e) {
          logger.warn(`[DELIVERY] sendDocument failed ref=${String(ref).slice(0, 20)}: ${e.message}`);
        }
      } else {
        logger.warn(`[DELIVERY] ref local inválida ou insegura name=${name} ref=${String(ref).slice(0, 40)}`);
      }
    }

    return false;
  }

  /**
   * Reenvia produto específico
   */
  async resend(telegram, chatId, orderId, productId) {
    try {
      const items = await prisma.orderItem.findMany({ where: { order_id: orderId } });
      const item = items.find((i) => i.product_id === parseInt(productId));
      if (!item) return false;

      const product = await prisma.product.findUnique({ where: { id: item.product_id } });
      if (!product?.file_url) return false;

      await this._deliverItem(
        telegram,
        chatId,
        {
          product_id: item.product_id,
          name: product.name,
          file_url: product.file_url,
        },
        { resend: true }
      );
      logger.info(`[DELIVERY] Reenvio ${productId} para ${chatId}`);
      return true;
    } catch (e) {
      logger.error(`[DELIVERY] Erro no reenvio: ${e.message}`);
      return false;
    }
  }

  /**
   * Verifica se entrega foi realizada
   */
  async isDelivered(orderId) {
    try {
      const order = await prisma.order.findFirst({ where: { id: orderId } });
      return order?.status === 'DELIVERED';
    } catch (e) {
      return false;
    }
  }
}

module.exports = new DeliveryService();
