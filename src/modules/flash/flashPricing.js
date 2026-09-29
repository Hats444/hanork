'use strict';

const { prisma } = require('../../config/database-sqlite');

function getActiveFlashSale(productId) {
    try {
        prisma.flashSale.expire?.();
        return prisma.flashSale.findActive(Number(productId));
    } catch {
        return null;
    }
}

/** Preço efetivo no checkout — flash sale ativa substitui o preço de catálogo. */
function resolveCheckoutPrice(product) {
    if (!product) return { price: 0, flashSaleId: null, originalPrice: 0 };
    const sale = getActiveFlashSale(product.id);
    if (sale) {
        return {
            price: Number(sale.sale_price),
            flashSaleId: sale.id,
            originalPrice: Number(sale.original_price),
        };
    }
    return {
        price: Number(product.price),
        flashSaleId: null,
        originalPrice: Number(product.price),
    };
}

module.exports = { getActiveFlashSale, resolveCheckoutPrice };
