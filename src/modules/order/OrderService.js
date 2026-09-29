/**
 * Module: Order Service
 * Regras de negócio para pedidos/ordens
 * Usa prisma.order (consistente com resto do codebase)
 */
const { prisma } = require('../../config/database-sqlite');
const logger = require('../../config/logger');
const { v4: uuidv4 } = require('uuid');

class OrderService {
  /**
   * Cria novo pedido
   */
  async create(userId, telegramId, items, calculatedTotal = null) {
    try {
      const tenantContext = require('../../infrastructure/TenantContext');
      const tid = tenantContext.getCurrentNumericId();
      if (tid) {
        const TenantLimits = require('../tenant/TenantLimits');
        TenantLimits.assertOrderLimit(tid);
      }

      // Calcular total
      let total = 0;
      const orderItems = [];
      for (const item of items) {
        const price = Number(item.price) || 0;
        const quantity = Number(item.quantity) || 1;
        total += price * quantity;
        orderItems.push({
          product_id: item.product_id,
          quantity,
          price
        });
      }

      const finalTotal = calculatedTotal !== null ? Number(calculatedTotal) : total;
      const id = uuidv4();

      const order = await prisma.order.create({
        data: {
          id,
          user_id: userId,
          status: 'CREATED',
          total: finalTotal,
          external_reference: id,
          order_items: orderItems
        }
      });

      logger.order(telegramId, null, order.id, finalTotal);
      return order;
    } catch (e) {
      logger.error(`[ORDER] Erro ao criar: ${e.message}`);
      throw e;
    }
  }

  /**
   * Busca pedido por ID
   */
  async findById(orderId) {
    try {
      return prisma.order.findFirst({ where: { id: orderId } });
    } catch (e) {
      logger.error(`[ORDER] Erro ao buscar ${orderId}: ${e.message}`);
      return null;
    }
  }

  /**
   * Busca pedidos do usuário
   */
  async findByUser(userId) {
    try {
      return prisma.order.findMany({ where: { user_id: userId } });
    } catch (e) {
      logger.error(`[ORDER] Erro ao listar do user ${userId}: ${e.message}`);
      return [];
    }
  }

  /**
   * Atualiza status do pedido
   */
  async updateStatus(orderId, status, additionalData = {}) {
    try {
      const data = { status, ...additionalData };
      await prisma.order.update({ where: { id: orderId }, data });
      logger.info(`[ORDER] ${orderId} -> ${status}`);
      return true;
    } catch (e) {
      logger.error(`[ORDER] Erro ao atualizar ${orderId}: ${e.message}`);
      return false;
    }
  }

  /**
   * Busca pedido pendente de pagamento do usuário
   */
  async findPendingPayment(userId) {
    try {
      return prisma.order.findFirst({
        where: {
          user_id: userId,
          status: 'WAITING_PAYMENT'
        }
      });
    } catch (e) {
      logger.error(`[ORDER] Erro ao buscar pendente: ${e.message}`);
      return null;
    }
  }

  /**
   * Verifica se usuário tem pedidos
   */
  async hasOrders(userId) {
    try {
      const count = await prisma.order.count({ where: { user_id: userId } });
      return count > 0;
    } catch (e) {
      return false;
    }
  }

  /**
   * Atualiza total do pedido
   */
  async updateTotal(orderId, total) {
    try {
      await prisma.order.update({
        where: { id: orderId },
        data: { total }
      });
      return true;
    } catch (e) {
      logger.error(`[ORDER] Erro ao atualizar total ${orderId}: ${e.message}`);
      return false;
    }
  }

  /**
   * Atualiza método de pagamento
   */
  async setPaymentMethod(orderId, method, paymentId = null) {
    try {
      const data = {
        status: 'WAITING_PAYMENT',
        payment_method: method
      };
      if (paymentId) data.payment_id = paymentId.toString();

      await prisma.order.update({ where: { id: orderId }, data });
      logger.info(`[ORDER] ${orderId} pagamento: ${method}`);
      return true;
    } catch (e) {
      logger.error(`[ORDER] Erro ao setar pagamento ${orderId}: ${e.message}`);
      return false;
    }
  }

  /**
   * Marca pedido como pago
   */
  async markPaid(orderId, paymentData = {}) {
    return this.updateStatus(orderId, 'PAID', paymentData);
  }

  /**
   * Marca pedido como entregue
   */
  async markDelivered(orderId) {
    return this.updateStatus(orderId, 'DELIVERED');
  }

  /**
   * Busca itens do pedido
   */
  async getItems(orderId) {
    try {
      const items = await prisma.orderItem.findMany({ where: { order_id: orderId } });
      return items || [];
    } catch (e) {
      logger.error(`[ORDER] Erro ao buscar itens ${orderId}: ${e.message}`);
      return [];
    }
  }

  /**
   * Busca pedidos por status
   */
  async findByStatus(userId, statuses) {
    try {
      const orders = await this.findByUser(userId);
      return orders.filter(o => statuses.includes(o.status));
    } catch (e) {
      return [];
    }
  }

  /**
   * Conta pedidos entregues
   */
  async countDelivered(userId) {
    try {
      const orders = await this.findByUser(userId);
      return orders.filter(o => o.status === 'DELIVERED').length;
    } catch (e) {
      return 0;
    }
  }

  /**
   * Calcula total gasto pelo usuário
   */
  async totalSpent(userId) {
    try {
      const orders = await this.findByUser(userId);
      const delivered = orders.filter(o => o.status === 'DELIVERED');
      return delivered.reduce((sum, o) => sum + (o.total || 0), 0);
    } catch (e) {
      return 0;
    }
  }

  /**
   * Busca pedidos pendentes de recuperação
   */
  async findPendingRecovery() {
    try {
      return prisma.order.findMany({ where: { status: 'WAITING_PAYMENT' } });
    } catch (e) {
      return [];
    }
  }
}

// Singleton
module.exports = new OrderService();
