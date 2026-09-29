'use strict';

const logger = require('../config/logger');
const { connect: dbConnect } = require('../config/database-sqlite');
const { COMMISSION_RATE } = require('../modules/affiliate/affiliateConfig');

/**
 * Pagamento único e idempotente de comissão (após entrega confirmada).
 */
class AffiliateCommissionService {
    /**
     * @param {object} opts
     * @param {number} opts.buyerUserId - users.id do comprador
     * @param {string} opts.orderId
     * @param {number} opts.total
     * @param {object} [opts.telegram] - bot.telegram para notificar
     * @param {number|null} [opts.tenantId]
     * @returns {Promise<{paid:boolean, commission?:number, reason?:string}>}
     */
    payCommission({ buyerUserId, orderId, total, telegram = null, tenantId = null }) {
        const db = dbConnect();
        if (!db || !buyerUserId || !orderId) {
            return Promise.resolve({ paid: false, reason: 'invalid_args' });
        }

        const orderTotal = Number(total);
        if (!Number.isFinite(orderTotal) || orderTotal <= 0) {
            return Promise.resolve({ paid: false, reason: 'zero_total' });
        }

        try {
            const result = db.transaction(() => {
                const already = db.prepare('SELECT id FROM referrals WHERE order_id = ?').get(orderId);
                if (already) return { paid: false, reason: 'already_paid' };

                let referral = db.prepare(`
                    SELECT r.id, r.affiliate_id, r.order_id, a.code, a.user_id AS affiliate_owner_id, u.telegram_id
                    FROM referrals r
                    JOIN affiliates a ON a.id = r.affiliate_id
                    JOIN users u ON u.id = a.user_id
                    WHERE r.referred_user_id = ? AND r.order_id IS NULL
                    LIMIT 1
                `).get(buyerUserId);

                if (!referral) return { paid: false, reason: 'no_referral' };

                if (tenantId != null && tenantId !== 'default') {
                    const rowTenant = db.prepare('SELECT tenant_id FROM referrals WHERE id = ?').get(referral.id);
                    const rt = rowTenant?.tenant_id;
                    if (rt != null && Number(rt) !== Number(tenantId)) {
                        return { paid: false, reason: 'tenant_mismatch' };
                    }
                }

                if (referral.affiliate_owner_id === buyerUserId) {
                    return { paid: false, reason: 'self_referral' };
                }

                const commission = Math.round(orderTotal * COMMISSION_RATE * 100) / 100;
                if (commission <= 0) return { paid: false, reason: 'zero_commission' };

                const upd = db.prepare(`
                    UPDATE referrals SET order_id = ?, commission = ?
                    WHERE id = ? AND order_id IS NULL
                `).run(orderId, commission, referral.id);

                if (upd.changes < 1) return { paid: false, reason: 'race' };

                db.prepare(`
                    UPDATE affiliates SET sales_count = sales_count + 1, earnings = earnings + ?
                    WHERE id = ?
                `).run(commission, referral.affiliate_id);

                return {
                    paid: true,
                    commission,
                    code: referral.code,
                    telegramId: referral.telegram_id,
                };
            })();

            if (result.paid) {
                logger.info('[Affiliate] Comissão paga', {
                    orderId: String(orderId).slice(-8),
                    commission: result.commission,
                    code: result.code,
                });
                this._notifyAffiliate(telegram, result).catch(() => {});
            }

            return Promise.resolve(result);
        } catch (e) {
            logger.error('[Affiliate] payCommission', { orderId, message: e.message });
            return Promise.resolve({ paid: false, reason: 'error' });
        }
    }

    async _notifyAffiliate(telegram, { telegramId, commission, orderId }) {
        if (!telegram || !telegramId) return;
        const pct = Math.round(COMMISSION_RATE * 100);
        await telegram.sendMessage(
            telegramId,
            `🎉 <b>Comissão creditada!</b>\n\n` +
            `💰 +R$ ${commission.toFixed(2)} (${pct}%)\n` +
            `📦 Pedido #${String(orderId).slice(-8)}\n\n` +
            `Saldo atualizado no seu painel.\n` +
            `Use /rendimentos para ver histórico ou solicitar saque.`,
            { parse_mode: 'HTML' }
        );
    }
}

module.exports = new AffiliateCommissionService();
