'use strict';

const { prisma } = require('../../config/database');
const { connect: dbConnect } = require('../../config/database-sqlite');
const logger = require('../../config/logger');
const WaDivulgacaoConfig = require('./waDivulgacaoConfig');
const { listPlans, parsePlanDaysFromProduct, isWaPlanName } = require('./waDivulgacaoPlans');
const { pushWaDivulgacaoPanel } = require('./helpers/waDivulgacaoPanelUi');
const { postPaymentKeyboard } = require('./keyboards/waDivulgacaoKeyboards');
const Copy = require('./waDivulgacaoCopy');

const ACTIVE_WHERE = `
    user_id = ? AND status IN ('active', 'cancelled')
    AND (
        plan_name LIKE 'Hanork Div%'
        OR plan_name LIKE 'WA Divulgação%'
        OR plan_name LIKE '%Zap PRO%'
    )
    AND datetime(replace(substr(next_payment_date, 1, 19), 'T', ' ')) > datetime('now')
`;

class WaDivulgacaoSubscriptionService {
    planLike() {
        return `${WaDivulgacaoConfig.planPrefix}%`;
    }

    listPlanProducts() {
        const db = dbConnect();
        if (!db) return [];
        return (
            db
                .prepare(
                    `SELECT * FROM products
                     WHERE active = 1 AND is_subscription = 1
                     AND (category = ? OR category LIKE 'wa_divulgacao_%' OR description LIKE '%WA_PLAN_DAYS=%')
                     ORDER BY price ASC`
                )
                .all(WaDivulgacaoConfig.productCategory) || []
        );
    }

    findActive(userId) {
        if (!userId) return null;
        const db = dbConnect();
        if (!db) return null;
        return (
            db
                .prepare(`SELECT * FROM subscriptions WHERE ${ACTIVE_WHERE} ORDER BY id DESC LIMIT 1`)
                .get(userId) || null
        );
    }

    isActive(userId) {
        return !!this.findActive(userId);
    }

    daysLeft(sub) {
        const next = sub?.next_payment_date ? new Date(sub.next_payment_date) : null;
        if (!next) return 0;
        return Math.max(0, Math.ceil((next - Date.now()) / 86400000));
    }

    async activateFromProduct({ userId, telegramId, product, telegram = null }) {
        const db = dbConnect();
        if (!db || !userId || !product) return { ok: false, reason: 'invalid' };

        const days = parsePlanDaysFromProduct(product);
        const planName = `${WaDivulgacaoConfig.planPrefix} · ${days} dia${days > 1 ? 's' : ''}`;
        const price = Number(product.price) || 0;
        const existing = this.findActive(userId);
        const now = new Date();
        let renewed = false;

        if (existing) {
            const base = new Date(existing.next_payment_date || now);
            const start = base > now ? base : now;
            const next = new Date(start);
            next.setDate(next.getDate() + days);
            db.prepare(
                `UPDATE subscriptions SET
                    plan_name = ?, plan_value = ?, billing_cycle = ?,
                    last_payment_date = ?, next_payment_date = ?,
                    total_payments = total_payments + 1, total_paid = total_paid + ?,
                    status = 'active'
                 WHERE id = ?`
            ).run(
                planName,
                price,
                `${days}d`,
                now.toISOString(),
                next.toISOString(),
                price,
                existing.id
            );
            renewed = true;
        } else {
            const next = new Date(now);
            next.setDate(next.getDate() + days);
            db.prepare(
                `INSERT INTO subscriptions (
                    user_id, telegram_id, plan_name, plan_value, billing_cycle,
                    status, last_payment_date, next_payment_date, total_payments, total_paid
                ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, 1, ?)`
            ).run(
                userId,
                String(telegramId),
                planName,
                price,
                `${days}d`,
                now.toISOString(),
                next.toISOString(),
                price
            );
        }

        db.prepare('UPDATE users SET is_premium = 1 WHERE id = ?').run(userId);
        logger.info('[WaDivulgacao] Plano ativado', {
            userId,
            telegramId,
            planName,
            days,
            renewed,
            price,
        });

        if (telegram && telegramId) {
            await this._sendActivationMessage(telegram, telegramId, { planName, days, renewed, price }).catch(
                (e) => logger.warn('[WaDivulgacao] activation message failed', { telegramId, error: e?.message })
            );
        }

        return { ok: true, renewed, days, planName };
    }

    async _sendActivationMessage(telegram, chatId, { planName, days, renewed, price }) {
        const action = renewed ? 'renovado' : 'ativado';
        const txt =
            `✅ <b>${Copy.brandTitle()} — plano ${action}!</b>\n\n` +
            `📦 <b>Plano:</b> ${planName}\n` +
            `⏰ <b>Duração:</b> +${days} dia${days > 1 ? 's' : ''}\n` +
            `💰 <b>Valor:</b> R$ ${Number(price).toFixed(2).replace('.', ',')}\n\n` +
            `Pagamento confirmado — seu painel já está liberado.\n\n` +
            Copy.formatActivationBenefits();

        await pushWaDivulgacaoPanel(telegram, chatId, chatId, txt, postPaymentKeyboard());
    }

    cancel(userId) {
        const db = dbConnect();
        if (!db || !userId) return false;
        const sub = this.findActive(userId);
        if (!sub || sub.status === 'cancelled') return false;
        const r = db
            .prepare(`UPDATE subscriptions SET status = 'cancelled', cancelled_at = datetime('now') WHERE id = ?`)
            .run(sub.id);
        return r.changes > 0;
    }

    formatBenefitsText() {
        return Copy.formatBenefitsList();
    }

    formatPlansPanel(products = [], ctxOrUser = null) {
        const { PRICE_PER_DAY } = require('./waDivulgacaoPlans');
        if (ctxOrUser) {
            return Copy.formatPreSalePanel(ctxOrUser, PRICE_PER_DAY);
        }
        return `${Copy.formatPreSalePitch(PRICE_PER_DAY)}\n\n${Copy.formatPreSaleCta()}`;
    }

    formatActivePanel(sub, connectionState = null, usageSummary = null) {
        const next = sub.next_payment_date ? new Date(sub.next_payment_date) : null;
        const daysLeft = this.daysLeft(sub);
        const renewNote =
            sub.status === 'cancelled'
                ? '⚠️ <i>Renovação cancelada — acesso até o fim do período</i>'
                : '<i>Renove comprando outro plano antes do vencimento</i>';

        let waLine = '📱 <b>WhatsApp:</b> 🔴 não conectado\n';
        if (connectionState?.connected) {
            waLine =
                '📱 <b>WhatsApp:</b> 🟢 conectado' +
                (connectionState.phone ? ` · <code>${connectionState.phone}</code>` : '') +
                '\n';
        }

        let usageLine = '';
        if (usageSummary) {
            usageLine =
                `📤 <b>Enviadas:</b> ${usageSummary.sent || 0}` +
                ` · 📣 <b>Campanhas:</b> ${usageSummary.campaigns || 0}`;
            if (usageSummary.scheduled > 0) {
                usageLine += ` · ⏰ <b>Agendadas:</b> ${usageSummary.scheduled}`;
            }
            usageLine += '\n';
        }

        let steps = '';
        if (!connectionState?.connected) {
            steps = Copy.formatNextStepsNotConnected();
        }

        return (
            `${Copy.brandTitle()} — <b>seu painel</b>\n\n` +
            `✅ <b>Plano:</b> ${sub.plan_name}\n` +
            (next ? `📅 <b>Válido até:</b> ${next.toLocaleDateString('pt-BR')}\n` : '') +
            `⏰ <b>Dias restantes:</b> ${daysLeft}\n` +
            waLine +
            usageLine +
            `\n${Copy.formatPostSaleBenefits()}` +
            steps +
            `\n\n${renewNote}`
        );
    }

    isWaPlanName(planName) {
        return isWaPlanName(planName);
    }
}

module.exports = new WaDivulgacaoSubscriptionService();
