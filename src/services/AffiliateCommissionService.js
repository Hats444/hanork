'use strict';

const logger = require('../config/logger');
const { connect: dbConnect } = require('../config/database-sqlite');
const { COMMISSION_RATE } = require('../modules/affiliate/affiliateConfig');

/**
 * Comissão recorrente por pedido entregue — cada compra do indicado gera comissão (idempotente por order_id).
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
                const already = db
                    .prepare('SELECT id FROM affiliate_commissions WHERE order_id = ?')
                    .get(orderId);
                if (already) return { paid: false, reason: 'already_paid' };

                const referral = db
                    .prepare(
                        `
                    SELECT r.id, r.affiliate_id, a.code, a.user_id AS affiliate_owner_id, u.telegram_id
                    FROM referrals r
                    JOIN affiliates a ON a.id = r.affiliate_id
                    JOIN users u ON u.id = a.user_id
                    WHERE r.referred_user_id = ?
                    LIMIT 1
                `
                    )
                    .get(buyerUserId);

                if (!referral) return { paid: false, reason: 'no_referral' };

                if (tenantId != null && tenantId !== 'default') {
                    const rowTenant = db
                        .prepare('SELECT tenant_id FROM referrals WHERE id = ?')
                        .get(referral.id);
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

                const ins = db
                    .prepare(
                        `
                    INSERT INTO affiliate_commissions (affiliate_id, referred_user_id, order_id, commission, tenant_id)
                    VALUES (?, ?, ?, ?, ?)
                `
                    )
                    .run(
                        referral.affiliate_id,
                        buyerUserId,
                        orderId,
                        commission,
                        tenantId != null && tenantId !== 'default' ? tenantId : null
                    );

                if (ins.changes < 1) return { paid: false, reason: 'race' };

                db.prepare(
                    `
                    UPDATE affiliates SET sales_count = sales_count + 1, earnings = earnings + ?
                    WHERE id = ?
                `
                ).run(commission, referral.affiliate_id);

                return {
                    paid: true,
                    commission,
                    code: referral.code,
                    telegramId: referral.telegram_id,
                    buyerUserId,
                };
            })();

            if (result.paid) {
                logger.info('[Affiliate] Comissão paga', {
                    orderId: String(orderId).slice(-8),
                    commission: result.commission,
                    code: result.code,
                });
                this._notifyAffiliate(telegram, result, orderId).catch(() => {});
                this._notifyAdminCommission(result, orderId).catch(() => {});
            }

            return Promise.resolve(result);
        } catch (e) {
            logger.error('[Affiliate] payCommission', { orderId, message: e.message });
            return Promise.resolve({ paid: false, reason: 'error' });
        }
    }

    async _notifyAffiliate(telegram, result, orderId) {
        const { telegramId, commission, code } = result || {};
        if (!telegram || !telegramId) return;

        const comm = Number(commission);
        if (!Number.isFinite(comm) || comm <= 0) return;

        const pct = Math.round(COMMISSION_RATE * 100);
        const ref = orderId ? `#${String(orderId).slice(-8)}` : '—';

        let productHint = '';
        try {
            const db = dbConnect();
            const row = orderId
                ? db
                      .prepare(
                          `SELECT p.name FROM order_items oi
                           LEFT JOIN products p ON p.id = oi.product_id
                           WHERE oi.order_id = ? LIMIT 1`
                      )
                      .get(orderId)
                : null;
            if (row?.name) productHint = `\n📦 ${String(row.name).trim()}`;
        } catch {
            /* ignore */
        }

        await telegram.sendMessage(
            telegramId,
            `🎉 <b>Comissão creditada!</b>\n\n` +
                `💰 <b>+R$ ${comm.toFixed(2)}</b> (${pct}%)\n` +
                `📋 Pedido <code>${ref}</code>` +
                productHint +
                (code ? `\n🤝 Seu código: <code>${code}</code>` : '') +
                `\n\n` +
                `Você ganha em <b>cada compra</b> dos seus indicados.\n` +
                `Use /rendimentos para ver histórico ou solicitar saque.`,
            { parse_mode: 'HTML' }
        );
    }

    async _notifyAdminCommission(result, orderId) {
        const { commission, code, telegramId, buyerUserId } = result || {};
        const comm = Number(commission);
        if (!orderId || !code || !Number.isFinite(comm) || comm <= 0) return;

        try {
            const { createAdminSaleNotifyService } = require('./AdminSaleNotifyService');
            const svc = createAdminSaleNotifyService({ dbRaw: dbConnect });
            await svc.notifyCommissionPaid({
                orderId,
                buyerUserId,
                commission: comm,
                code,
                affiliateTelegramId: telegramId,
            });
        } catch (e) {
            logger.warn('[Affiliate] admin PV comissão', { orderId, detail: e.message });
        }
    }
}

module.exports = new AffiliateCommissionService();
