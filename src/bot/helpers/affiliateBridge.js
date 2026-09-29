'use strict';

const AffiliateCore = require('../../modules/affiliate/AffiliateCore');
const AffiliateCommissionService = require('../../services/AffiliateCommissionService');

function createAffiliateBridge({ prisma, affSaldoAplicado, logger, UserService, getTelegram }) {
    async function getAffSaldo(telegramId) {
        return AffiliateCore.getBalanceByTelegramId(telegramId);
    }

    async function processAffiliateRef(ctx, refCode) {
        const user = await prisma.user.findUnique({ where: { telegram_id: ctx.from.id.toString() } });
        if (!user) return;
        const tenantId =
            ctx.tenant?.mode === 'tenant' && ctx.tenant.id != null ? Number(ctx.tenant.id) : null;
        await AffiliateCore.processReferral({
            referredUserId: user.id,
            refCode,
            tenantId,
        });
    }

    async function payAffiliateCommission(userId, orderId, total, tenantId = null) {
        await AffiliateCommissionService.payCommission({
            buyerUserId: userId,
            orderId,
            total,
            telegram: getTelegram(),
            tenantId,
        });
    }

    async function confirmarSaldoReservado(chatId, userId) {
        try {
            const key = String(userId);
            const reserved = await affSaldoAplicado.get(key);
            const amount = Number(reserved?.amount ?? reserved);
            if (amount > 0) {
                await UserService.confirmAffiliateReserve(userId, amount);
                await affSaldoAplicado.delete(key);
                logger.info(`[AFF] Saldo reservado confirmado pós-entrega user=${userId} R$ ${amount.toFixed(2)}`);
            }
        } catch (e) {
            logger.warn('[AFF] confirmarSaldoReservado', { chatId, userId, message: e?.message });
        }
    }

    async function pedirAvaliacao(chatId, orderId) {
        try {
            const ReviewService = require('../../services/ReviewService');
            await ReviewService.sendReviewRequest(getTelegram(), chatId, orderId);
        } catch (e) {
            logger.warn('[REVIEW] pedirAvaliacao', { chatId, orderId, message: e?.message });
        }
    }

    async function getWalletSaldo(telegramId) {
        const UserWalletService = require('../../services/UserWalletService');
        return UserWalletService.getBalanceByTelegramId(telegramId);
    }

    return {
        getAffSaldo,
        getWalletSaldo,
        processAffiliateRef,
        payAffiliateCommission,
        confirmarSaldoReservado,
        pedirAvaliacao,
    };
}

module.exports = { createAffiliateBridge };
