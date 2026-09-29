/**
 * Safe Delivery Service
 * Entrega de produtos com proteção contra duplicação
 * Locks distribuídos + Idempotência + Audit trail
 */
const DeliveryService = require('./DeliveryService');
const DeliveryMessaging = require('./DeliveryMessaging');
const DistributedLock = require('../infra/DistributedLock');
const TransactionManager = require('../infra/TransactionManager');
const { prisma } = require('../../config/database-sqlite');
const logger = require('../../config/logger');
const crypto = require('crypto');
const { computePostSaleDue } = require('../../utils/postSaleSchedule');

class SafeDeliveryService {
  /**
   * Entrega segura com lock distribuído e idempotência
   * Garante: entrega exatamente uma vez (exactly-once semantics)
   */
  async deliverSafe(telegram, chatId, items, orderId, userId) {
    const lockResource = `delivery:${orderId}`;
    let lock;
    try {
      lock = await DistributedLock.acquire(lockResource, 300); // 5 min lock
    } catch (e) {
      if (e?.code === 'REDIS_LOCK_UNAVAILABLE') {
        logger.error(`[SAFE-DELIVERY] Redis fail-closed — entrega recusada para ${orderId}`);
        return { delivered: false, reason: 'redis_lock_unavailable', orderId, retry: true };
      }
      throw e;
    }

    if (!lock) {
      if (DistributedLock.isRedisFailClosedEnabled?.()) {
        logger.error(`[SAFE-DELIVERY] Redis lock unavailable (fail-closed) for ${orderId}`);
        return { delivered: false, reason: 'redis_lock_unavailable', orderId, retry: true };
      }
      // Redis offline - usar fallback em memória (degradado mas funcional)
      logger.warn(`[SAFE-DELIVERY] Redis lock unavailable for ${orderId}, using memory lock`);
      return this._deliverWithMemoryLock(telegram, chatId, items, orderId, userId);
    }

    try {
      // Verificação dupla: banco + lock
      const alreadyDelivered = await this._isAlreadyDelivered(orderId);
      if (alreadyDelivered) {
        logger.info(`[SAFE-DELIVERY] Order ${orderId} already delivered, skipping`);
        return { delivered: false, reason: 'already_delivered', orderId };
      }

      // Verificar hash de conteúdo (detecta tentativa de entrega idêntica)
      const contentHash = this._computeHash(items);
      const duplicateHash = await this._checkDuplicateHash(orderId, contentHash);
      if (duplicateHash) {
        logger.warn(`[SAFE-DELIVERY] Duplicate content hash detected for ${orderId}`);
        return { delivered: false, reason: 'duplicate_hash', orderId };
      }

      // Cabeçalho único antes da entrega
      await DeliveryMessaging.sendPaymentHeader(telegram, chatId, orderId);

      // Fase 1: marcar DELIVERING (só DB)
      const markResult = await TransactionManager.execute([
        async (ctx) => {
          await ctx.tx.order.update({
            where: { id: orderId },
            data: { status: 'DELIVERING' }
          });
          return { phase: 'marking_delivering' };
        }
      ]);

      if (!markResult.success) {
        logger.error(`[SAFE-DELIVERY] Failed to mark DELIVERING for ${orderId}: ${markResult.error}`);
        throw new Error(`Delivery mark failed: ${markResult.error}`);
      }

      // Fase 2: entrega Telegram FORA da transação (evita rollback com produto já enviado)
      let deliveredResults;
      try {
        deliveredResults = await DeliveryService.deliver(telegram, chatId, items);
      } catch (deliverErr) {
        await this._markDeliveryFailed(orderId, deliverErr.message);
        throw deliverErr;
      }

      // Fase 3: audit trail + DELIVERED
      const finalizeResult = await TransactionManager.execute([
        async (ctx) => {
          await this._createDeliveryLog(ctx.tx, orderId, userId, items, contentHash, 'SUCCESS');
          await ctx.tx.order.update({
            where: { id: orderId },
            data: {
              status: 'DELIVERED',
              delivered_at: new Date().toISOString(),
              post_sale_due: computePostSaleDue(),
              post_sale_sent: 0,
            }
          });
          return { phase: 'completed' };
        }
      ]);

      if (!finalizeResult.success) {
        logger.error(`[SAFE-DELIVERY] Finalize failed for ${orderId}: ${finalizeResult.error}`);
        throw new Error(`Delivery finalize failed: ${finalizeResult.error}`);
      }

      const txResult = { success: true, txId: finalizeResult.txId, results: [{ phase: 'marking_delivering' }, { results: deliveredResults, phase: 'delivered' }] };

      // Pós-processamento completo (cashback, afiliados, pontos, financeiro, notificações)
      // Executa fora da transação principal - não é crítico para a entrega
      const productNames = items.map((i) => i.name).filter(Boolean);

      await DeliveryMessaging.sendDeliverySummary(telegram, chatId, orderId, productNames);

      await this._postDeliveryProcessing(
        txResult, telegram, chatId, userId, orderId, deliveredResults
      ).catch(err => {
        logger.warn(`[SAFE-DELIVERY] Post-delivery processing failed for ${orderId}: ${err.message}`);
        // Não falha a entrega se pós-processamento falhar
      });

      logger.info(`[SAFE-DELIVERY] Order ${orderId} delivered successfully`);

      try {
        const { trackConversionEvent } = require('../../services/ConversionEventService');
        if (userId) trackConversionEvent(userId, 'delivery_completed', { order_id: orderId });
      } catch (_) { /* telemetry */ }

      return {
        delivered: true,
        orderId,
        items: deliveredResults,
        txId: txResult.txId
      };

    } catch (error) {
      logger.error(`[SAFE-DELIVERY] Fatal error for ${orderId}: ${error.message}`);
      throw error;
    } finally {
      // SEMPRE liberar lock
      await lock.release();
    }
  }

  /**
   * Fallback quando Redis está offline
   * Usa Set em memória (menos seguro, mas funcional)
   */
  async _deliverWithMemoryLock(telegram, chatId, items, orderId, userId) {
    // Usar deliveringOrders global do bot.js se disponível
    const globalLock = global.deliveringOrders || new Set();

    if (globalLock.has(orderId)) {
      return { delivered: false, reason: 'memory_locked', orderId };
    }

    globalLock.add(orderId);

    try {
      // Verificar banco
      const order = await prisma.order.findFirst({ where: { id: orderId } });
      if (order?.status === 'DELIVERED') {
        return { delivered: false, reason: 'already_delivered', orderId };
      }

      // Entregar
      await DeliveryMessaging.sendPaymentHeader(telegram, chatId, orderId);

      await prisma.order.update({
        where: { id: orderId },
        data: { status: 'DELIVERING' }
      });

      const results = await DeliveryService.deliver(telegram, chatId, items);
      const productNames = items.map((i) => i.name).filter(Boolean);
      await DeliveryMessaging.sendDeliverySummary(telegram, chatId, orderId, productNames);

      await prisma.order.update({
        where: { id: orderId },
        data: {
          status: 'DELIVERED',
          delivered_at: new Date().toISOString(),
          post_sale_due: computePostSaleDue(),
          post_sale_sent: 0,
        }
      });

      return { delivered: true, orderId, items: results, fallback: true };

    } finally {
      globalLock.delete(orderId);
    }
  }

  /**
   * Verifica se pedido já foi entregue
   */
  async _isAlreadyDelivered(orderId) {
    try {
      const order = await prisma.order.findFirst({
        where: { id: orderId },
        select: { status: true }
      });
      return order?.status === 'DELIVERED';
    } catch (e) {
      return false;
    }
  }

  /**
   * Computa hash dos items para detectar duplicação
   */
  _computeHash(items) {
    const content = JSON.stringify(items.map(i => ({
      id: i.product_id,
      qty: i.quantity,
      price: i.price
    })));
    return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
  }

  /**
   * Verifica se hash já foi entregue (previne re-entrega idêntica)
   */
  async _checkDuplicateHash(orderId, hash) {
    try {
      const existing = await prisma.deliveryLog?.findFirst?.({
        where: { order_id: orderId, content_hash: hash }
      });
      return existing != null;
    } catch (e) {
      // Tabela pode não existir
      return false;
    }
  }

  /**
   * Cria registro de entrega (audit trail)
   */
  async _createDeliveryLog(tx, orderId, userId, items, contentHash, status) {
    try {
      await tx.deliveryLog?.create?.({
        data: {
          order_id: orderId,
          user_id: userId,
          items_count: items.length,
          content_hash: contentHash,
          status,
          created_at: new Date().toISOString()
        }
      });
    } catch (e) {
      // Tabela pode não existir, logar em arquivo
      logger.info(`[DELIVERY-LOG] ${orderId} | ${contentHash} | ${status}`);
    }
  }

  /**
   * Marca entrega como falha
   */
  async _markDeliveryFailed(orderId, error) {
    try {
      await prisma.order.update({
        where: { id: orderId },
        data: { status: 'DELIVERY_FAILED', error_message: error.slice(0, 500) }
      });
    } catch (e) {
      logger.error(`[SAFE-DELIVERY] Failed to mark failure for ${orderId}: ${e.message}`);
    }
  }

  /**
   * Adiciona pontos de fidelidade (não-crítico)
   * Não aplica para assinaturas
   */
  async _addLoyaltyPoints(userId, orderId, items, total) {
    try {
      const ASSINATURA_PRODUCT_ID = parseInt(process.env.ASSINATURA_PRODUCT_ID) || null;

      const isSubPurchase = items.some(i =>
        (ASSINATURA_PRODUCT_ID && i.product_id === ASSINATURA_PRODUCT_ID) ||
        i.name?.toLowerCase().includes('assinatura') ||
        i.name?.toLowerCase().includes('premium') ||
        i.name?.toLowerCase().includes('vip') ||
        i.type === 'subscription'
      );

      if (isSubPurchase) {
        logger.info(`[LOYALTY] Skipping points for subscription purchase ${orderId}`);
        return { points: 0 };
      }

      const pointsToAdd = Math.floor(total);
      if (pointsToAdd <= 0) return { points: 0 };

      try {
        prisma.loyalty.addPoints(userId, pointsToAdd, `Compra #${orderId.slice(-8)}`, orderId);
      } catch (_) { /* ignore */ }

      const loyalty = prisma.loyalty?.getOrCreate?.(userId) || null;
      logger.info(`[LOYALTY] Added ${pointsToAdd} points to user ${userId} for order ${orderId}`);
      return { points: pointsToAdd, loyaltyTotal: loyalty?.points ?? pointsToAdd };
    } catch (e) {
      logger.error(`[LOYALTY] Error adding points for ${orderId}: ${e.message}`);
      return { points: 0 };
    }
  }

  /**
   * Cria cashback (5% base / premium)
   */
  async _createCashback(userId, orderId, total) {
    try {
      const CustomerSubscriptionService = require('../../modules/subscription/CustomerSubscriptionService');
      const { PREMIUM_CASHBACK_PERCENT, BASE_CASHBACK_PERCENT } = require('../../modules/subscription/subscriptionConfig');
      const isPremium = CustomerSubscriptionService.isActive(userId);
      const percent = isPremium ? PREMIUM_CASHBACK_PERCENT : BASE_CASHBACK_PERCENT;
      const cashbackAmount = total * (percent / 100);

      if (cashbackAmount <= 0) return { cashbackAmount: 0 };

      try {
        prisma.cashback.create(userId, orderId, total, percent);
      } catch (_) { /* ignore */ }

      logger.info(`[CASHBACK] Created R$ ${cashbackAmount.toFixed(2)} for user ${userId}, order ${orderId}`);
      return { cashbackAmount, cashbackPercent: percent, isPremium };
    } catch (e) {
      logger.error(`[CASHBACK] Error creating cashback for ${orderId}: ${e.message}`);
      return { cashbackAmount: 0 };
    }
  }

  async _payAffiliateCommission(userId, orderId, total, telegram) {
    try {
      const order = await prisma.order.findUnique({ where: { id: orderId } });
      const AffiliateCommissionService = require('../../services/AffiliateCommissionService');
      await AffiliateCommissionService.payCommission({
        buyerUserId: userId,
        orderId,
        total,
        telegram,
        tenantId: order?.tenant_id ?? null,
      });
    } catch (e) {
      logger.error(`[AFFILIATE] Error paying commission for ${orderId}: ${e.message}`);
    }
  }

  /**
   * Registra no sistema financeiro — cash_flow/metas ficam no handler ORDER_PAID (evita duplicata)
   */
  async _registerFinance(_userId, orderId, _total, _paymentMethod, _items, _telegram, _chatId) {
    logger.debug(`[FINANCE] Venda ${orderId} registrada via ORDER_PAID (skip duplicata na entrega)`);
  }

  /**
   * @deprecated Use AdminSaleNotifyService (ORDER_PAID). Mantido para compat.
   */
  async _notifyAdmins(_orderId, _chatId, _total, _items, _telegram) {
    /* noop — PV admin via AdminSaleNotifyService */
  }

  /** Solicita avaliação (uso externo: entrega manual legada) */
  async requestReview(telegram, chatId, orderId) {
    return this._requestReview(telegram, chatId, orderId);
  }

  /**
   * Solicita avaliação do cliente
   */
  async _requestReview(telegram, chatId, orderId) {
    try {
      const ReviewService = require('../../services/ReviewService');
      await ReviewService.sendReviewRequest(telegram, chatId, orderId);
    } catch (e) {
      logger.warn(`[REVIEW] Error requesting review for ${orderId}: ${e.message}`);
    }
  }

  /**
   * Executa pós-entrega completa (cashback, afiliados, pontos, etc)
   * Chamado após entrega bem-sucedida
   */
  async _postDeliveryProcessing(result, telegram, chatId, userId, orderId, items) {
    try {
      const order = await prisma.order.findUnique({ where: { id: orderId } });

      if (!order) return;

      const total = Number(order.total) || 0;
      const paymentMethod = order.payment_method || 'pix';

      const loyalty = await this._addLoyaltyPoints(userId, orderId, items, total);
      const cashback = await this._createCashback(userId, orderId, total);

      await DeliveryMessaging.sendExtrasBundle(telegram, chatId, {
        points: loyalty.points,
        loyaltyTotal: loyalty.loyaltyTotal,
        cashbackAmount: cashback.cashbackAmount,
        cashbackPercent: cashback.cashbackPercent,
        isPremium: cashback.isPremium,
      });

      await this._payAffiliateCommission(userId, orderId, total, telegram);
      await this._registerFinance(userId, orderId, total, paymentMethod, items, telegram, chatId);
      // Venda no PV admin: handler ORDER_PAID (AdminSaleNotifyService)

      DeliveryMessaging.scheduleReviewRequest(telegram, chatId, orderId);

      try {
        const UserEmailService = require('../../services/UserEmailService');
        UserEmailService.promptRegisterEmailIfNeeded(telegram, chatId).catch(() => {});
      } catch (_) { /* ignore */ }

      logger.info(`[POST-DELIVERY] Completed for order ${orderId}`);
    } catch (e) {
      logger.error(`[POST-DELIVERY] Error for ${orderId}: ${e.message}`);
      // Não propagar - pós-processamento não é crítico
    }
  }

  /**
   * Reenvio seguro
   */
  async resendSafe(telegram, chatId, orderId, productId) {
    // Reenvio não precisa de lock (é intencional)
    return DeliveryService.resend(telegram, chatId, orderId, productId);
  }

  /**
   * Recuperação após crash
   * Verifica pedidos em DELIVERING há muito tempo
   */
  async recoverStuckDeliveries() {
    try {
      const allDelivering = await prisma.order.findMany({ where: { status: 'DELIVERING' } });
      const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const stuck = allDelivering.filter(o => o.updated_at && o.updated_at < cutoff);

      if (stuck.length) {
        logger.warn(`[SAFE-DELIVERY] Found ${stuck.length} stuck deliveries`);
      } else {
        logger.info('[SAFE-DELIVERY] Nenhuma entrega presa em DELIVERING');
      }

      const QueueHelpers = require('../queue/QueueHelpers');

      for (const order of stuck) {
        await DistributedLock.forceRelease(`delivery:${order.id}`);

        await prisma.order.update({
          where: { id: order.id },
          data: { status: 'PAID', error_message: 'Recovered from stuck DELIVERING — re-agendando entrega' }
        });

        const user = await prisma.user.findUnique({ where: { id: order.user_id } });
        const rawItems = await prisma.orderItem.findMany({ where: { order_id: order.id } });
        const deliveryItems = await Promise.all(rawItems.map(async (i) => {
          const prod = await prisma.product.findUnique({ where: { id: i.product_id } });
          return {
            product_id: i.product_id,
            quantity: i.quantity,
            price: i.price,
            name: prod?.name || 'Produto',
            file_url: prod?.file_url || '',
            is_subscription: !!prod?.is_subscription,
          };
        }));

        if (user?.telegram_id && deliveryItems.length) {
          await QueueHelpers.scheduleDelivery(
            order.id,
            user.telegram_id,
            deliveryItems,
            order.user_id
          );
          logger.info(`[SAFE-DELIVERY] Re-scheduled delivery for stuck order ${order.id}`);
        }
      }

      return stuck.length;
    } catch (e) {
      logger.error(`[SAFE-DELIVERY] Recovery failed: ${e.message}`);
      return 0;
    }
  }
}

module.exports = new SafeDeliveryService();
