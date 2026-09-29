'use strict';

const CartService = require('../../modules/cart/CartService');
const CustomerSubscriptionService = require('../../modules/subscription/CustomerSubscriptionService');

/**
 * Adapter Cart — delega para CartService (compat legado bot.js).
 */
function createCartAdapter(getProductById) {
    class Cart {
        static async add(chatId, pid, productOrQty) {
            if (typeof productOrQty === 'number') {
                const p = await getProductById(parseInt(pid, 10));
                if (!p) throw new Error(`Produto ${pid} não encontrado`);
                const { resolveCheckoutPrice } = require('../../modules/flash/flashPricing');
                const pricing = resolveCheckoutPrice(p);
                return CartService.add(chatId, pid, { ...p, price: pricing.price });
            }
            return CartService.add(chatId, pid, productOrQty);
        }

        static async get(chatId) {
            return CartService.get(chatId);
        }

        static async total(chatId) {
            return CartService.total(chatId);
        }

        static async clear(chatId) {
            return CartService.clear(chatId);
        }

        static async remove(chatId, pid) {
            return CartService.remove(chatId, pid);
        }

        static async decrement(chatId, pid) {
            return CartService.decrement(chatId, pid);
        }

        static async isEmpty(chatId) {
            return CartService.isEmpty(chatId);
        }

        static async summary(chatId) {
            return CartService.summary(chatId);
        }

        static async items(chatId) {
            return CartService.items(chatId);
        }

        static async count(chatId) {
            return CartService.count(chatId);
        }

        static async subscriptionDiscount(chatId, userId) {
            if (!userId) return { active: false, discount: 0, percent: 0 };
            const isSubscriber = CustomerSubscriptionService.isActive(userId);
            if (!isSubscriber) return { active: false, discount: 0, percent: 0 };
            const total = await this.total(chatId);
            const percent = CustomerSubscriptionService.getCheckoutDiscountPercent();
            const discount = total * (percent / 100);
            return { active: true, discount, percent };
        }

        static async totalWithDiscount(chatId, userId) {
            const total = await this.total(chatId);
            const subDiscount = await this.subscriptionDiscount(chatId, userId);
            return total - subDiscount.discount;
        }
    }

    return Cart;
}

module.exports = { createCartAdapter };
