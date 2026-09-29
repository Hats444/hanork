'use strict';

const { prisma } = require('../../config/database');
const { connect: dbConnect } = require('../../config/database-sqlite');
const logger = require('../../config/logger');
const {
    CHECKOUT_DISCOUNT,
    WELCOME_COUPON_PERCENT,
    WELCOME_COUPON_COUNT,
    WELCOME_COUPON_DAYS,
    REMINDER_DAYS_BEFORE,
} = require('./subscriptionConfig');

const ACTIVE_WHERE = `
    user_id = ? AND status IN ('active', 'cancelled')
    AND datetime(replace(substr(next_payment_date, 1, 19), 'T', ' ')) > datetime('now')
`;

class CustomerSubscriptionService {
    getCheckoutDiscountPercent() {
        return Math.round(CHECKOUT_DISCOUNT * 100);
    }

    isActive(userId) {
        if (!userId) return false;
        const db = dbConnect();
        if (!db) return false;
        const row = db.prepare(`SELECT COUNT(*) AS c FROM subscriptions WHERE ${ACTIVE_WHERE}`).get(userId);
        return (row?.c || 0) > 0;
    }

    findActive(userId) {
        if (!userId) return null;
        const db = dbConnect();
        if (!db) return null;
        return db.prepare(`SELECT * FROM subscriptions WHERE ${ACTIVE_WHERE} ORDER BY id DESC LIMIT 1`).get(userId) || null;
    }

    findLatest(userId) {
        if (!userId) return null;
        const db = dbConnect();
        if (!db) return null;
        return db.prepare('SELECT * FROM subscriptions WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(userId) || null;
    }

    findSubscriptionProduct() {
        const products = prisma.product.findMany({ where: { is_subscription: true, active: true } });
        return products?.[0] || null;
    }

    listSubscriptionProducts() {
        return prisma.product.findMany({ where: { is_subscription: true, active: true } }) || [];
    }

    /**
     * Ativa ou renova assinatura após pagamento confirmado + entrega.
     */
    async activateOrRenew({ userId, telegramId, planName = 'Premium', planPrice = 29.9, telegram = null }) {
        const db = dbConnect();
        if (!db || !userId) return { ok: false, reason: 'invalid' };

        const price = Number(planPrice) || 29.9;
        const name = planName || 'Premium';
        const existing = this.findActive(userId);
        let renewed = false;

        if (existing) {
            prisma.subscription.renew(userId, price);
            renewed = true;
            logger.info('[Subscription] Renovada', { userId, planName: name });
        } else {
            prisma.subscription.create({
                user_id: userId,
                telegram_id: String(telegramId),
                plan_name: name,
                plan_value: price,
                billing_cycle: 'monthly',
            });
            logger.info('[Subscription] Criada', { userId, planName: name });
        }

        const coupons = this._generateWelcomeCoupons(userId);

        if (telegram && telegramId) {
            await this._sendActivationMessage(telegram, telegramId, {
                planName: name,
                renewed,
                coupons,
            }).catch(() => {});
        }

        return { ok: true, renewed, coupons };
    }

    _generateWelcomeCoupons(userId) {
        const db = dbConnect();
        if (!db) return [];
        const coupons = [];
        const expires = new Date();
        expires.setDate(expires.getDate() + WELCOME_COUPON_DAYS);
        const expiresIso = expires.toISOString();

        for (let i = 1; i <= WELCOME_COUPON_COUNT; i++) {
            const code = `PREM${String(userId).slice(-4)}${Date.now().toString(36).toUpperCase().slice(-3)}${i}`;
            try {
                db.prepare(
                    `INSERT OR IGNORE INTO coupons (code, type, value, max_uses, used, active, expires_at)
                     VALUES (?, 'percent', ?, 1, 0, 1, ?)`
                ).run(code, WELCOME_COUPON_PERCENT, expiresIso);
                coupons.push(code);
            } catch { /* ignore duplicate */ }
        }
        return coupons;
    }

    async _sendActivationMessage(telegram, chatId, { planName, renewed, coupons }) {
        const pct = this.getCheckoutDiscountPercent();
        const action = renewed ? 'renovada' : 'ativada';
        let txt =
            `<b>💎 ${planName} ${action}!</b>\n\n` +
            `✅ <b>${pct}% OFF</b> automático no checkout\n` +
            `✅ Cashback premium (${require('./subscriptionConfig').PREMIUM_CASHBACK_PERCENT}%)\n` +
            `✅ Suporte prioritário\n`;

        if (coupons.length && !renewed) {
            txt +=
                `\n🎁 <b>${coupons.length} cupons de ${WELCOME_COUPON_PERCENT}%:</b>\n` +
                coupons.map((c) => `🏷️ <code>${c}</code>`).join('\n') +
                `\n\n<i>Válidos por ${WELCOME_COUPON_DAYS} dias</i>\n`;
        }

        txt += `\n📅 Válida por 30 dias — renove comprando o plano novamente.\nUse /assinatura para gerenciar.`;

        await telegram.sendMessage(chatId, txt, { parse_mode: 'HTML' });
    }

    /**
     * Cancela renovação; benefícios até next_payment_date.
     */
    cancel(userId) {
        const db = dbConnect();
        if (!db || !userId) return false;
        const sub = this.findActive(userId);
        if (!sub || sub.status === 'cancelled') return false;
        const r = db.prepare(`
            UPDATE subscriptions SET status = 'cancelled', cancelled_at = datetime('now')
            WHERE id = ? AND status = 'active'
        `).run(sub.id);
        return r.changes > 0;
    }

    expireDueSubscriptions() {
        const db = dbConnect();
        if (!db) return 0;
        const r = db.prepare(`
            UPDATE subscriptions SET status = 'expired'
            WHERE status IN ('active', 'cancelled')
            AND datetime(replace(substr(next_payment_date, 1, 19), 'T', ' ')) <= datetime('now')
        `).run();
        if (r.changes > 0) {
            logger.info('[Subscription] Expiradas', { count: r.changes });
        }
        return r.changes;
    }

    /**
     * Assinaturas que vencem em N dias (lembrete de renovação manual).
     */
    findExpiringSoon(days = REMINDER_DAYS_BEFORE) {
        const db = dbConnect();
        if (!db) return [];
        return db.prepare(`
            SELECT s.*, u.telegram_id AS user_telegram_id, u.first_name
            FROM subscriptions s
            JOIN users u ON u.id = s.user_id
            WHERE s.status = 'active'
            AND date(datetime(replace(substr(s.next_payment_date, 1, 19), 'T', ' ')))
                BETWEEN date('now') AND date('now', '+' || ? || ' days')
        `).all(days);
    }

    formatBenefitsText() {
        const pct = this.getCheckoutDiscountPercent();
        const cfg = require('./subscriptionConfig');
        return (
            `• <b>${pct}% OFF</b> automático no checkout\n` +
            `• Cashback premium (${cfg.PREMIUM_CASHBACK_PERCENT}%)\n` +
            `• Canal de referências e novidades\n` +
            `• Suporte prioritário\n` +
            `• ${WELCOME_COUPON_COUNT} cupons de ${WELCOME_COUPON_PERCENT}% na ativação`
        );
    }

    formatActivePanel(sub) {
        const next = sub.next_payment_date ? new Date(sub.next_payment_date) : null;
        const daysLeft = next ? Math.max(0, Math.ceil((next - Date.now()) / 86400000)) : 0;
        const renewNote = sub.status === 'cancelled'
            ? '⚠️ <i>Renovação cancelada — benefícios até o fim do período</i>'
            : '<i>Renove comprando o plano antes do vencimento</i>';

        return (
            `💎 <b>Assinatura Premium</b>\n\n` +
            `✅ <b>Status:</b> ${sub.status === 'cancelled' ? 'Ativa (sem renovação)' : 'Ativa'}\n` +
            `📦 <b>Plano:</b> ${sub.plan_name}\n` +
            `💰 <b>Valor:</b> R$ ${Number(sub.plan_value).toFixed(2)}/mês\n` +
            (next ? `📅 <b>Válida até:</b> ${next.toLocaleDateString('pt-BR')}\n` : '') +
            `⏰ <b>Dias restantes:</b> ${daysLeft}\n` +
            `💳 <b>Total pago:</b> R$ ${Number(sub.total_paid || 0).toFixed(2)}\n\n` +
            `<b>Benefícios:</b>\n${this.formatBenefitsText()}\n\n` +
            renewNote
        );
    }

    formatInactivePanel(products = []) {
        const list = products.length
            ? products.map((p) => `• <b>${p.name}</b> — R$ ${Number(p.price).toFixed(2)}/mês`).join('\n')
            : '• Consulte o suporte para planos disponíveis';

        return (
            `💎 <b>Seja Premium</b>\n\n` +
            `Desbloqueie benefícios exclusivos:\n\n` +
            `${list}\n\n` +
            `<b>Inclui:</b>\n${this.formatBenefitsText()}\n\n` +
            `<i>A assinatura é mensal — renove comprando o plano a cada 30 dias.</i>`
        );
    }

    async _enrichItem(item) {
        if (!item) return null;
        if (item.is_subscription) return item;
        if (!item.product_id) return { ...item, is_subscription: false };
        const prod = await prisma.product.findUnique({ where: { id: item.product_id } });
        if (prod?.is_subscription) {
            return {
                ...item,
                price: item.price ?? prod.price,
                name: item.name || prod.name,
                is_subscription: true,
            };
        }
        return { ...item, is_subscription: false };
    }

    /** Separa itens de assinatura dos demais (carrinho com vários produtos). */
    async partitionDeliveryItems(items) {
        if (!items?.length) return { subscriptionItems: [], regularItems: [] };
        const subscriptionItems = [];
        const regularItems = [];
        for (const raw of items) {
            const item = await this._enrichItem(raw);
            if (item.is_subscription) subscriptionItems.push(item);
            else regularItems.push(item);
        }
        return { subscriptionItems, regularItems };
    }

    /** Primeiro item de assinatura, se houver (compatibilidade). */
    async isSubscriptionItem(items) {
        const { subscriptionItems } = await this.partitionDeliveryItems(items);
        return subscriptionItems[0] || null;
    }

    /** True se todos os itens forem assinatura. */
    async isSubscriptionOnlyCart(items) {
        const { subscriptionItems, regularItems } = await this.partitionDeliveryItems(items);
        return subscriptionItems.length > 0 && regularItems.length === 0;
    }
}

module.exports = new CustomerSubscriptionService();
