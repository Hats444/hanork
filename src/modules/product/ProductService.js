/**
 * Module: Product Service
 * Gestão de produtos, catálogo e estoque
 */
const { prisma } = require('../../config/database-sqlite');
const logger = require('../../config/logger');

class ProductService {
  /**
   * Busca produto por ID (sempre do banco para preço atualizado)
   */
  async findById(productId) {
    try {
      const p = await prisma.product.findUnique({
        where: { id: parseInt(productId) }
      });
      if (p && !p.active) return null;
      if (p) {
        logger.debug(`[PRODUCT] findById: ${p.id} - R$ ${p.price}`);
      }
      return p;
    } catch (e) {
      logger.error(`[PRODUCT] Erro ao buscar ${productId}: ${e.message}`);
      return null;
    }
  }

  /**
   * Busca produtos por categoria
   */
  async findByCategory(categoryId) {
    try {
      const all = await prisma.product.findMany({ where: { active: true } });
      return all.filter(p => p.category === categoryId || p.category_id === categoryId)
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch (e) {
      logger.error(`[PRODUCT] Erro ao listar categoria ${categoryId}: ${e.message}`);
      return [];
    }
  }

  /**
   * Lista todos os produtos ativos
   */
  async listActive() {
    try {
      return prisma.product.findMany({
        where: { active: true },
        orderBy: { name: 'asc' }
      });
    } catch (e) {
      logger.error(`[PRODUCT] Erro ao listar: ${e.message}`);
      return [];
    }
  }

  /**
   * Decrementa estoque (após pagamento)
   */
  async decrementStock(items) {
    for (const item of items) {
      try {
        const prod = await prisma.product.findUnique({
          where: { id: item.product_id }
        });

        if (prod && prod.stock !== undefined && prod.stock !== 999) {
          const newStock = Math.max(0, prod.stock - item.quantity);
          await prisma.product.update({
            where: { id: item.product_id },
            data: { stock: newStock }
          });
          logger.info(`[STOCK] Produto ${item.product_id}: ${prod.stock} -> ${newStock}`);
        }
      } catch (e) {
        logger.error(`[STOCK] Erro ao decrementar ${item.product_id}: ${e.message}`);
      }
    }
  }

  /**
   * Verifica disponibilidade de estoque
   */
  async checkStock(productId, quantity = 1) {
    try {
      const p = await this.findById(productId);
      if (!p) return { available: false, reason: 'not_found' };
      if (p.stock === 999) return { available: true, stock: 999 };
      if (p.stock < quantity) return { available: false, stock: p.stock, reason: 'insufficient' };
      return { available: true, stock: p.stock };
    } catch (e) {
      return { available: false, reason: 'error' };
    }
  }

  /**
   * Busca produtos por termo
   */
  async search(term) {
    try {
      const all = await prisma.product.findMany({ where: { active: true } });
      const lower = term.toLowerCase();
      return all.filter(p =>
        p.name?.toLowerCase().includes(lower) ||
        p.description?.toLowerCase().includes(lower)
      ).sort((a, b) => a.name.localeCompare(b.name));
    } catch (e) {
      logger.error(`[PRODUCT] Erro na busca "${term}": ${e.message}`);
      return [];
    }
  }

  /**
   * Obtém produtos em promoção
   */
  async getOnSale() {
    try {
      const all = await prisma.product.findMany({ where: { active: true } });
      return all.filter(p => p.sale_price != null).sort((a, b) => a.name.localeCompare(b.name));
    } catch (e) {
      return [];
    }
  }

  /**
   * Conta produtos por categoria
   */
  async countByCategory(categoryId) {
    try {
      const all = await prisma.product.findMany({ where: { active: true } });
      return all.filter(p => p.category === categoryId || p.category_id === categoryId).length;
    } catch (e) {
      return 0;
    }
  }

  /**
   * Busca produtos favoritos do usuário
   */
  async getFavorites(userId) {
    try {
      return prisma.favorite.findByUser(userId);
    } catch (e) {
      return [];
    }
  }

  /**
   * Toggle favorito
   */
  async toggleFavorite(userId, productId) {
    try {
      const added = await prisma.favorite.toggle(userId, productId);
      logger.info(`[FAVORITE] User ${userId} ${added ? 'add' : 'remove'} ${productId}`);
      return added;
    } catch (e) {
      logger.error(`[FAVORITE] Erro: ${e.message}`);
      return null;
    }
  }
}

module.exports = new ProductService();
