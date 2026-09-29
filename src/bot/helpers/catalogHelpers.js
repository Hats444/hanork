'use strict';

const ProductService = require('../../modules/product/ProductService');

function createCatalogHelpers({ prisma, logger }) {
    async function loadProducts() {
        try {
            const p = await prisma.product.findMany({ where: { active: true } });
            logger.debug(`[DB] loadProducts: ${p.length} produtos carregados`);
            return p;
        } catch (e) {
            logger.error('loadProducts:', e.message);
            return [];
        }
    }

    async function getProductById(productId) {
        return ProductService.findById(productId);
    }

    function invalidateProductCache() {
        logger.debug('[CACHE] invalidateProductCache chamado (no-op)');
    }

    return { loadProducts, getProductById, invalidateProductCache };
}

module.exports = { createCatalogHelpers };
