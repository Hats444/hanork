/**
 * Safe Webhook Handler
 * Processa webhooks Mercado Pago com locks distribuídos e idempotência
 * Previne race conditions e entregas duplicadas
 */
const DistributedLock = require('../infra/DistributedLock');
const TransactionManager = require('../infra/TransactionManager');
const logger = require('../../config/logger');
const { prisma } = require('../../config/database-sqlite');
const { isCancelled } = require('../order/orderStatus');

const PAID_STATUSES = new Set(['PAID', 'DELIVERING']);

class SafeWebhookHandler {
  async _loadOrderUser(order) {
    if (order?.user?.telegram_id) return order.user;
    if (!order?.user_id) return {};
    return (await prisma.user.findUnique({ where: { id: order.user_id } })) || {};
  }

  async buildDeliveryItems(orderId) {
    const rawItems = await prisma.orderItem.findMany({ where: { order_id: orderId } });
    return Promise.all(rawItems.map(async (i) => {
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
  }

  /** order_items → Redis pending → reconstruir do pedido legado */
  async resolveDeliveryItems(orderId) {
    const fromDb = await this.buildDeliveryItems(orderId);
    if (fromDb.length) return fromDb;

    try {
      const { getStateManager } = require('../state');
      const pending = await getStateManager().findPendingPurchaseByOrderId(orderId);
      if (pending?.items?.length) {
        logger.info(`[WEBHOOK] Itens recuperados do pending Redis order=${orderId}`);
        return pending.items.map((i) => ({
          product_id: i.product_id,
          quantity: i.quantity || 1,
          price: i.price,
          name: i.name || 'Produto',
          file_url: i.file_url || '',
          is_subscription: !!i.is_subscription,
        }));
      }
    } catch (e) {
      logger.warn(`[WEBHOOK] resolveDeliveryItems pending falhou order=${orderId}: ${e.message}`);
    }

    logger.warn(`[WEBHOOK] resolveDeliveryItems: pedido ${orderId} sem itens`);
    return [];
  }

  /**
   * Garante entrega para pedido pago que ainda não foi entregue (retry seguro).
   */
  async ensureDeliveryForOrder(order) {
    if (!order?.id) return { scheduled: false, reason: 'no_order' };
    if (order.status === 'DELIVERED') return { scheduled: false, reason: 'already_delivered' };

    const fresh = await prisma.order.findFirst({ where: { id: order.id } });
    if (!fresh || fresh.status === 'DELIVERED') {
      return { scheduled: false, reason: 'already_delivered' };
    }

    if (!PAID_STATUSES.has(fresh.status) && fresh.status !== 'PAYMENT_ERROR') {
      return { scheduled: false, reason: 'not_paid', status: fresh.status };
    }

    const user = await this._loadOrderUser(fresh);
    if (!user?.telegram_id) {
      logger.error(`[WEBHOOK] ensureDelivery: sem telegram_id order=${fresh.id}`);
      return { scheduled: false, reason: 'no_telegram' };
    }

    const { isSmmHanorkOrder } = require('../smm/helpers/smmPendingHelper');
    const { isVirtuoHanorkOrder } = require('../virtuo/helpers/virtuoPendingHelper');
    const QueueHelpers = require('../queue/QueueHelpers');

    if (isVirtuoHanorkOrder(fresh.id)) {
      const r = await QueueHelpers.scheduleVirtuoFulfill(
        fresh.id,
        user.telegram_id,
        fresh.user_id
      );
      logger.info(`[WEBHOOK] Virtuo fulfill (re)agendado order=${fresh.id}`);
      return { scheduled: true, ...r, virtuo: true };
    }

    if (isSmmHanorkOrder(fresh.id)) {
      const r = await QueueHelpers.scheduleSmmFulfill(
        fresh.id,
        user.telegram_id,
        fresh.user_id
      );
      logger.info(`[WEBHOOK] SMM fulfill (re)agendado order=${fresh.id}`);
      return { scheduled: true, ...r, smm: true };
    }

    let deliveryItems = await this.resolveDeliveryItems(fresh.id);
    if (!deliveryItems.length) {
      return { scheduled: false, reason: 'no_items' };
    }

    const r = await QueueHelpers.scheduleDelivery(
      fresh.id,
      user.telegram_id,
      deliveryItems,
      fresh.user_id
    );
    logger.info(`[WEBHOOK] Entrega (re)agendada order=${fresh.id} via=${r.via || 'unknown'}`);
    return { scheduled: true, ...r };
  }
  /**
   * Processa pagamento com segurança máxima
   * Garante: processamento exatamente uma vez
   */
  async processPayment(paymentId, paymentData, bot) {
    const { external_reference, status, transaction_amount, payment_method_id } = paymentData;

    if (external_reference?.startsWith('plan_')) {
      const { processPlanPayment } = require('../tenant/planPayment');
      return processPlanPayment(paymentId, paymentData, bot);
    }

    if (status !== 'approved') {
      logger.info(`[WEBHOOK] Payment ${paymentId} not approved (${status}), skipping`);
      return { processed: false, reason: 'not_approved' };
    }

    if (!external_reference) {
      logger.warn(`[WEBHOOK] Payment ${paymentId} has no external_reference`);
      return { processed: false, reason: 'no_reference' };
    }

    // Buscar pedido (MP envia external_reference = id do pedido ou campo legado)
    let order =
      (await prisma.order.findFirst({ where: { external_reference } })) ||
      (await prisma.order.findUnique({ where: { id: external_reference } }));
    if (order) {
      order.user = await prisma.user.findUnique({ where: { id: order.user_id } }) || {};
    }

    if (!order) {
      logger.error(`[WEBHOOK] Order not found for ref: ${external_reference}`);
      return { processed: false, reason: 'order_not_found' };
    }

    if (isCancelled(order.status)) {
      logger.warn(`[WEBHOOK] Order ${order.id} cancelado — pagamento ${paymentId} ignorado`);
      return { processed: false, reason: 'order_cancelled' };
    }

    const paidAmount = Number(transaction_amount);
    const orderTotal = Number(order.total);
    if (!Number.isFinite(paidAmount) || !Number.isFinite(orderTotal) || Math.abs(paidAmount - orderTotal) > 0.02) {
      logger.error(`[WEBHOOK] Valor divergente pedido ${order.id}: esperado R$ ${orderTotal}, recebido R$ ${paidAmount}`);
      return { processed: false, reason: 'amount_mismatch' };
    }

    if (order.status === 'DELIVERED') {
      logger.info(`[WEBHOOK] Order ${order.id} already delivered, skipping`);
      return { processed: false, reason: 'already_delivered', orderId: order.id };
    }

    // Adquirir lock distribuído (previne processamento paralelo do mesmo pedido)
    let lock;
    try {
      lock = await DistributedLock.acquire(`payment:${order.id}`, 300, 50, 100);
    } catch (e) {
      if (e?.code === 'REDIS_LOCK_UNAVAILABLE') {
        logger.error(`[WEBHOOK] Redis fail-closed — lock indisponível para ${order.id}`);
        return { processed: false, reason: 'redis_lock_unavailable', orderId: order.id, retry: true };
      }
      throw e;
    }
    let dbPaymentLock = false;

    if (!lock) {
      logger.warn(`[WEBHOOK] Redis lock indisponível para ${order.id} — usando lock atômico no banco`);
      const dbLocked = prisma.order.lockDelivery(order.id, String(paymentId));
      if (!dbLocked) {
        const currentOrder = await prisma.order.findFirst({ where: { id: order.id } });
        if (currentOrder?.status === 'DELIVERED') {
          return { processed: false, reason: 'already_delivered', orderId: order.id };
        }
        if (PAID_STATUSES.has(currentOrder?.status)) {
          await this.ensureDeliveryForOrder(currentOrder);
          return { processed: false, reason: 'already_paid', orderId: order.id };
        }
        // Lock preso por tentativa anterior falha — liberar se pedido ainda não pago/entregue
        if (currentOrder?.delivered_payment_id === String(paymentId)
            && !PAID_STATUSES.has(currentOrder?.status)
            && currentOrder?.status !== 'DELIVERED') {
          prisma.order.releasePaymentLock(order.id, String(paymentId));
          const retryLock = prisma.order.lockDelivery(order.id, String(paymentId));
          if (retryLock) {
            dbPaymentLock = true;
          } else {
            return { processed: false, reason: 'lock_unavailable', orderId: order.id };
          }
        } else {
          return { processed: false, reason: 'lock_unavailable', orderId: order.id };
        }
      } else {
        dbPaymentLock = true;
      }
    }

    try {
      const freshOrder = await prisma.order.findFirst({ where: { id: order.id } });

      if (freshOrder?.status === 'DELIVERED') {
        logger.info(`[WEBHOOK] Order ${order.id} already delivered, skipping`);
        return { processed: false, reason: 'already_delivered', orderId: order.id };
      }

      const samePaymentId = freshOrder?.payment_id === String(paymentId);
      const alreadyPaid = samePaymentId && PAID_STATUSES.has(freshOrder?.status);

      if (alreadyPaid) {
        logger.info(`[WEBHOOK] Order ${order.id} já pago — garantindo entrega`);
        await this.ensureDeliveryForOrder(freshOrder);
        return { processed: false, reason: 'already_paid', orderId: order.id };
      }

      // payment_id gravado ao gerar PIX (WAITING_PAYMENT) — não é "já processado"
      if (samePaymentId && freshOrder?.status === 'WAITING_PAYMENT') {
        logger.info(`[WEBHOOK] Order ${order.id} PIX aprovado (payment_id já no pedido)`);
      }

      // Executar processamento em transação
      const txResult = await TransactionManager.execute([
        async (ctx) => {
          // Atualizar status para PAID
          await ctx.tx.order.update({
            where: { id: order.id },
            data: {
              status: 'PAID',
              payment_id: String(paymentId),
              payment_method: payment_method_id || 'pix',
              paid_at: new Date().toISOString(),
              error_message: null,
            }
          });
          return { phase: 'marked_paid' };
        }
      ]);

      if (!txResult.success) {
        logger.error(`[WEBHOOK] Transaction failed for order ${order.id}: ${txResult.error}`);
        throw new Error(`Payment transaction failed: ${txResult.error}`);
      }

      logger.info(`[WEBHOOK] Order ${order.id} marked as PAID (tx: ${txResult.txId})`);

      const QueueHelpers = require('../queue/QueueHelpers');
      const { eventBus, DomainEvents } = require('../../infrastructure');
      const { isSmmHanorkOrder } = require('../smm/helpers/smmPendingHelper');
      const { isVirtuoHanorkOrder } = require('../virtuo/helpers/virtuoPendingHelper');

      if (isVirtuoHanorkOrder(order.id)) {
        const payUser = await this._loadOrderUser(order);
        if (!payUser?.telegram_id) {
          logger.error(`[WEBHOOK] Virtuo fulfill sem telegram_id order=${order.id}`);
          throw new Error('telegram_id ausente para fulfill Virtuo');
        }
        await QueueHelpers.scheduleVirtuoFulfill(
          order.id,
          payUser.telegram_id,
          order.user_id
        );
        await eventBus.emit(DomainEvents.ORDER_PAID, {
          orderId: order.id,
          userId: order.user_id,
          total: order.total,
          items: [],
          orderKind: 'virtuo',
          paymentId: String(paymentId),
          tenantId: order.tenant_id || 'default',
        });
        logger.info(`[WEBHOOK] Virtuo fulfill scheduled order=${order.id}, ORDER_PAID emitted`);
        return {
          processed: true,
          orderId: order.id,
          paymentId,
          txId: txResult.txId,
          virtuo: true,
        };
      }

      if (isSmmHanorkOrder(order.id)) {
        await QueueHelpers.scheduleSmmFulfill(
          order.id,
          order.user?.telegram_id,
          order.user_id
        );
        await eventBus.emit(DomainEvents.ORDER_PAID, {
          orderId: order.id,
          userId: order.user_id,
          total: order.total,
          items: [],
          orderKind: 'smm',
          paymentId: String(paymentId),
          tenantId: order.tenant_id || 'default',
        });
        logger.info(`[WEBHOOK] SMM fulfill scheduled order=${order.id}, ORDER_PAID emitted`);
        return {
          processed: true,
          orderId: order.id,
          paymentId,
          txId: txResult.txId,
          smm: true,
        };
      }

      const deliveryItems = await this.resolveDeliveryItems(order.id);
      if (!deliveryItems.length) {
        logger.error(`[WEBHOOK] Order ${order.id} sem itens para entrega`);
        throw new Error('Pedido sem itens para entrega');
      }

      await QueueHelpers.scheduleDelivery(
        order.id,
        order.user?.telegram_id,
        deliveryItems,
        order.user_id
      );

      // EMITIR EVENTO: Notificar outros domínios (cashback, affiliate, analytics)
      // Isso desacopla o processamento de pagamento das reações (cashback, notificações)
      await eventBus.emit(DomainEvents.ORDER_PAID, {
        orderId: order.id,
        userId: order.user_id,
        total: order.total,
        items: deliveryItems,
        paymentId: String(paymentId),
        tenantId: order.tenant_id || 'default'
      });

      logger.info(`[WEBHOOK] Delivery scheduled for order ${order.id}, ORDER_PAID event emitted`);

      return {
        processed: true,
        orderId: order.id,
        paymentId,
        txId: txResult.txId
      };

    } catch (error) {
      logger.error(`[WEBHOOK] Fatal error processing payment ${paymentId}: ${error.message}`);

      // Tentar marcar como falha para investigação
      try {
        await prisma.order.update({
          where: { id: order.id },
          data: {
            status: 'PAYMENT_ERROR',
            error_message: error.message.slice(0, 500)
          }
        });
      } catch (e) { }

      if (dbPaymentLock) {
        const released = prisma.order.releasePaymentLock(order.id, String(paymentId));
        if (released) {
          logger.info(`[WEBHOOK] Payment lock liberado para retry order=${order.id}`);
        }
      }

      throw error;
    } finally {
      if (lock) {
        await lock.release();
      }
    }
  }

  /**
   * Verifica se pagamento já foi processado (idempotência)
   */
  async isPaymentProcessed(paymentId) {
    try {
      const existing = await prisma.order.findFirst({
        where: { payment_id: String(paymentId) }
      });
      return existing != null;
    } catch (e) {
      return false;
    }
  }

  /**
   * Recuperação de pagamentos presos
   * Pagamentos PAID mas não entregues há muito tempo
   */
  async recoverStuckPayments() {
    try {
      const allPaid = await prisma.order.findMany({ where: { status: 'PAID' } });
      const cutoff = new Date(Date.now() - 5 * 60 * 1000);
      const stuck = allPaid.filter(o => !o.paid_at || new Date(o.paid_at) < cutoff);
      for (const o of stuck) {
        o.user = await prisma.user.findUnique({ where: { id: o.user_id } }) || {};
      }

      if (stuck.length) {
        logger.warn(`[WEBHOOK] Found ${stuck.length} stuck payments (PAID not delivered)`);
      } else {
        logger.info('[WEBHOOK] Nenhum pagamento preso (PAID sem entrega)');
      }

      for (const order of stuck) {
        // Verificar se já tem job na fila
        const hasJob = await this.checkDeliveryJobExists(order.id);

        if (!hasJob) {
          logger.info(`[WEBHOOK] Re-scheduling delivery for stuck order ${order.id}`);

          await this.ensureDeliveryForOrder(order);
        }
      }

      return stuck.length;
    } catch (e) {
      logger.error(`[WEBHOOK] Recovery failed: ${e.message}`);
      return 0;
    }
  }

  /**
   * Verifica se job de entrega existe na fila
   */
  async checkDeliveryJobExists(orderId) {
    try {
      const { isVirtuoHanorkOrder } = require('../virtuo/helpers/virtuoPendingHelper');
      if (isVirtuoHanorkOrder(orderId)) {
        const VirtuoOrderRepository = require('../virtuo/repositories/virtuoOrderRepository');
        const vo = VirtuoOrderRepository.findByHanorkOrderId(orderId);
        if (!vo) return false;
        if (['waiting_sms', 'completed', 'cancelled', 'failed'].includes(String(vo.status))) {
          return true;
        }
        return false;
      }

      const order = await prisma.order.findFirst({
        where: { id: orderId },
        select: { updated_at: true, status: true }
      });

      if (order?.status === 'DELIVERED') return true;

      // DELIVERING recente = entrega em curso
      if (order?.status === 'DELIVERING') {
        const updated = new Date(order?.updated_at || 0);
        return (Date.now() - updated.getTime()) < 3 * 60 * 1000;
      }

      return false;
    } catch (e) {
      return false;
    }
  }
}

module.exports = new SafeWebhookHandler();
