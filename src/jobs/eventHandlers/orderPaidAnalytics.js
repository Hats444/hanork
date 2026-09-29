'use strict';

const { DomainEvents } = require('../../infrastructure');

/**
 * B3 M5 — analytics cash_flow / sales_goals (move-only de bot.js).
 */
function registerOrderPaidAnalytics(eventBus, { dbRaw, logger }) {
    eventBus.on(DomainEvents.ORDER_PAID, async ({ orderId, userId, total, tenantId }) => {
        try {
            const db = dbRaw();
            const existing = db
                .prepare(`SELECT 1 FROM cash_flow WHERE order_id = ? AND type = 'income' LIMIT 1`)
                .get(orderId);
            if (existing) {
                logger.debug(`[ANALYTICS] Order ${orderId} já registrado em cash_flow — skip`);
                return;
            }

            db.prepare(`
            INSERT INTO cash_flow (type, category, amount, description, order_id, user_id, tenant_id, created_at)
            VALUES ('income', 'sales', ?, ?, ?, ?, ?, datetime('now'))
        `).run(total, `Venda #${orderId.slice(-8)}`, orderId, userId, tenantId || null);

            const today = new Date().toISOString().slice(0, 10);
            const goal = db
                .prepare(`
            SELECT * FROM sales_goals WHERE start_date <= ? AND end_date >= ? AND (tenant_id=? OR tenant_id IS NULL) LIMIT 1
        `)
                .get(today, today, tenantId || null);

            if (goal) {
                db.prepare(`
                UPDATE sales_goals 
                SET achieved_amount = achieved_amount + ?, achieved_orders = achieved_orders + 1
                WHERE id=?
            `).run(total, goal.id);
            }

            logger.info(
                `[ANALYTICS] Order ${orderId} recorded, total: R$ ${total.toFixed(2)}, tenant: ${tenantId}`
            );
        } catch (e) {
            logger.error('[ANALYTICS] Erro:', e.message);
        }
    });
}

module.exports = { registerOrderPaidAnalytics };
