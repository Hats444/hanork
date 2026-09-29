'use strict';

/**
 * Fachada do sistema de afiliados — use AffiliateCore + AffiliateCommissionService.
 */
const AffiliateCore = require('./AffiliateCore');
const AffiliateCommissionService = require('../../services/AffiliateCommissionService');
const { COMMISSION_RATE, WITHDRAW_MIN } = require('./affiliateConfig');

class AffiliateService {
    generateAffiliateCode(telegramId) {
        return AffiliateCore.generateAffiliateCode(telegramId);
    }

    async generateInviteLink(userId, telegramId) {
        const aff = await AffiliateCore.ensureAffiliate(userId, telegramId);
        const bot = process.env.BOT_USERNAME || 'hanork_bot';
        return AffiliateCore.affiliateStartLink(bot, aff.code);
    }

    async processInvite(referredUserId, referrerCode, tenantId = null) {
        return AffiliateCore.processReferral({
            referredUserId,
            refCode: referrerCode,
            tenantId,
        });
    }

    calculateCommission(saleAmount) {
        return Math.round(Number(saleAmount) * COMMISSION_RATE * 100) / 100;
    }

    async payOrderCommission(buyerUserId, orderId, total, telegram = null, tenantId = null) {
        return AffiliateCommissionService.payCommission({
            buyerUserId,
            orderId,
            total,
            telegram,
            tenantId,
        });
    }

    async getStats(userId, telegramId) {
        const aff = await AffiliateCore.ensureAffiliate(userId, telegramId);
        const bot = process.env.BOT_USERNAME || 'hanork_bot';
        return {
            balance: AffiliateCore.affiliateEarnings(aff),
            referrals: aff.referred_count || 0,
            sales: aff.sales_count || 0,
            code: aff.code,
            link: AffiliateCore.affiliateStartLink(bot, aff.code),
            commissionPercent: Math.round(COMMISSION_RATE * 100),
            withdrawMin: WITHDRAW_MIN,
        };
    }

    async getReferrals(userId) {
        const { prisma } = require('../../config/database');
        const aff = await prisma.affiliate.findByUser(userId);
        if (!aff) return [];
        return prisma.referral.findByAffiliate(aff.id, 20) || [];
    }

    async getReferrer(userId) {
        const db = require('../../config/database-sqlite').connect();
        if (!db) return null;
        const ref = db.prepare(`
            SELECT a.user_id AS referrer_user_id
            FROM referrals r
            JOIN affiliates a ON a.id = r.affiliate_id
            WHERE r.referred_user_id = ?
            LIMIT 1
        `).get(userId);
        if (!ref) return null;
        const { prisma } = require('../../config/database');
        return prisma.user.findUnique({ where: { id: ref.referrer_user_id } });
    }
}

module.exports = new AffiliateService();
