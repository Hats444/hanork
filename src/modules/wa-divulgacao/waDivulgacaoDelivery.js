'use strict';

const { prisma } = require('../../config/database');
const { isWaDivulgacaoProduct, isHanorkDivBrand } = require('./waDivulgacaoPlans');
const WaDivulgacaoSubscriptionService = require('./waDivulgacaoSubscriptionService');

async function activateWaDivulgacaoFromDelivery(telegram, chatId, subItem) {
    const user = await prisma.user.findUnique({ where: { telegram_id: String(chatId) } });
    if (!user) return { ok: false, reason: 'no_user' };

    const product = subItem.product_id
        ? await prisma.product.findUnique({ where: { id: subItem.product_id } })
        : null;

    if (!isWaDivulgacaoProduct(product) && !isHanorkDivBrand(subItem.name)) {
        return { ok: false, reason: 'not_wa_product' };
    }

    return WaDivulgacaoSubscriptionService.activateFromProduct({
        userId: user.id,
        telegramId: chatId,
        product: product || { name: subItem.name, price: subItem.price, description: subItem.description },
        telegram,
    });
}

function shouldHandleSubscriptionItem(subItem, product) {
    if (isWaDivulgacaoProduct(product)) return true;
    if (isHanorkDivBrand(subItem?.name)) return true;
    return false;
}

module.exports = {
    activateWaDivulgacaoFromDelivery,
    shouldHandleSubscriptionItem,
};
