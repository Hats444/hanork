'use strict';

const { prisma } = require('../../config/database');
const CustomerSubscriptionService = require('../subscription/CustomerSubscriptionService');
const AffiliateCore = require('../affiliate/AffiliateCore');
const UserWalletService = require('../../services/UserWalletService');

async function getAccountSummary(telegramId) {
    const user = await prisma.user.findUnique({ where: { telegram_id: String(telegramId) } });
    if (!user) return null;

    const [loyalty, affiliate, orders, cashbackAvailable, cashbackPending, sub, walletBalance] = await Promise.all([
        Promise.resolve().then(() => prisma.loyalty?.getOrCreate?.(user.id)).catch(() => ({ points: 0, level: 'bronze' })),
        Promise.resolve().then(() => prisma.affiliate?.findByUser?.(user.id)).catch(() => null),
        Promise.resolve().then(() => prisma.order?.findMany?.({ where: { user_id: user.id } })).catch(() => []),
        Promise.resolve().then(() => Number(prisma.cashback?.getAvailable?.(user.id) || 0)).catch(() => 0),
        Promise.resolve().then(() => Number(prisma.cashback?.getPending?.(user.id) || 0)).catch(() => 0),
        Promise.resolve().then(() => CustomerSubscriptionService.findActive(user.id)).catch(() => null),
        Promise.resolve().then(() => UserWalletService.getBalance(user.id)).catch(() => 0),
    ]);

    const delivered = (orders || []).filter((o) => ['PAID', 'DELIVERED'].includes(o.status)).length;

    return {
        user,
        loyalty: loyalty || { points: 0, level: 'bronze' },
        affiliate,
        affiliateBalance: AffiliateCore.affiliateEarnings(affiliate),
        walletBalance: Number(walletBalance) || 0,
        orderCount: orders?.length || 0,
        deliveredCount: delivered,
        cashbackAvailable: Number(cashbackAvailable) || 0,
        cashbackPending: Number(cashbackPending) || 0,
        subscription: sub,
        isPremium: !!sub,
    };
}

function formatRegistrationDate(createdAt) {
    if (!createdAt) return '—';
    try {
        return new Date(createdAt).toLocaleDateString('pt-BR');
    } catch {
        return String(createdAt).slice(0, 10);
    }
}

module.exports = {
    getAccountSummary,
    formatRegistrationDate,
};
