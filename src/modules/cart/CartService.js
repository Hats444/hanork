/**
 * Module: Cart Service
 * Regras de negócio para carrinho de compras
 * Usa prisma.cart (consistente com resto do codebase)
 */
const { prisma } = require('../../config/database-sqlite');
const logger = require('../../config/logger');

class CartService {
  /**
   * Busca ou cria usuário pelo telegram_id
   */
  async getOrCreateUser(telegramId) {
    const user = await prisma.user.findUnique({
      where: { telegram_id: String(telegramId) }
    });

    if (user) return user;

    const newUser = await prisma.user.upsert({
      where: { telegram_id: String(telegramId) },
      create: { telegram_id: String(telegramId) },
      update: {}
    });

    logger.info(`[CART] Novo usuário: ${telegramId}`);
    return newUser;
  }

  /**
   * Adiciona item ao carrinho (API compatível com código existente)
   */
  async add(chatId, pid, product) {
    try {
      const user = await this.getOrCreateUser(chatId);

      // Usa prisma.cart.add que já existe no database-sqlite.js
      const result = await prisma.cart.add(user.id, chatId, pid, product.name, product.price);
      if (result?.inserted) {
        try {
          const { trackConversionEvent } = require('../../services/ConversionEventService');
          trackConversionEvent(user.id, 'cart_created', { product_id: pid, name: product.name }, user.tenant_id);
        } catch (_) { /* telemetry */ }
      }

      logger.info(`[CART] ADD: ${chatId} -> ${product?.name || pid}`);
      return this.get(chatId);
    } catch (e) {
      logger.error(`[CART] Erro ao adicionar: ${e.message}`);
      throw e;
    }
  }

  /**
   * Busca carrinho do usuário (API compatível)
   */
  async get(chatId) {
    try {
      const user = await prisma.user.findUnique({
        where: { telegram_id: String(chatId) }
      });

      if (!user) return [];

      const items = await prisma.cart.get(user.id);
      return items || [];
    } catch (e) {
      logger.error(`[CART] Erro ao buscar: ${e.message}`);
      return [];
    }
  }

  /**
   * Calcula total do carrinho
   */
  async total(chatId) {
    try {
      const user = await prisma.user.findUnique({
        where: { telegram_id: String(chatId) }
      });

      if (!user) return 0;

      const total = await prisma.cart.total(user.id);
      return total || 0;
    } catch (e) {
      logger.error(`[CART] Erro ao calcular total: ${e.message}`);
      return 0;
    }
  }

  /**
   * Limpa carrinho
   */
  async clear(chatId) {
    try {
      const user = await prisma.user.findUnique({
        where: { telegram_id: String(chatId) }
      });

      if (!user) return;

      await prisma.cart.clear(user.id);
      logger.info(`[CART] CLEAR: ${chatId}`);
    } catch (e) {
      logger.error(`[CART] Erro ao limpar: ${e.message}`);
    }
  }

  /**
   * Remove item específico
   */
  async remove(chatId, pid) {
    try {
      const user = await prisma.user.findUnique({
        where: { telegram_id: String(chatId) }
      });

      if (!user) return;

      await prisma.cart.remove(user.id, parseInt(pid));
      logger.info(`[CART] REMOVE: ${chatId} -> ${pid}`);
      return this.get(chatId);
    } catch (e) {
      logger.error(`[CART] Erro ao remover: ${e.message}`);
    }
  }

  /**
   * Decrementa quantidade
   */
  async decrement(chatId, pid) {
    try {
      const user = await prisma.user.findUnique({
        where: { telegram_id: String(chatId) }
      });

      if (!user) return false;

      const result = await prisma.cart.decrement(user.id, parseInt(pid));
      logger.info(`[CART] DECREMENT: ${chatId} -> ${pid}`);
      return result;
    } catch (e) {
      logger.error(`[CART] Erro ao decrementar: ${e.message}`);
      return false;
    }
  }

  /**
   * Verifica se carrinho está vazio
   */
  async isEmpty(chatId) {
    try {
      const user = await prisma.user.findUnique({
        where: { telegram_id: String(chatId) }
      });

      if (!user) return true;

      const items = await prisma.cart.get(user.id);
      return !items || items.length === 0;
    } catch (e) {
      return true;
    }
  }

  /**
   * Retorna contagem de itens
   */
  async count(chatId) {
    try {
      const user = await prisma.user.findUnique({
        where: { telegram_id: String(chatId) }
      });

      if (!user) return 0;

      return await prisma.cart.count(user.id);
    } catch (e) {
      return 0;
    }
  }

  /**
   * Retorna itens formatados para exibição
   */
  async items(chatId) {
    return this.get(chatId);
  }

  /**
   * Gera resumo textual do carrinho
   */
  async summary(chatId) {
    const items = await this.get(chatId);
    if (!items || items.length === 0) return null;

    return items.map(item =>
      `• ${item.product_name || item.name || 'Produto'} x${item.quantity} = R$ ${((item.product_price || item.price || 0) * item.quantity).toFixed(2)}`
    ).join('\n');
  }
}

// Singleton
module.exports = new CartService();
