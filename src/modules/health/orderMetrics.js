'use strict';

/** Pedidos PAID/DELIVERING parados além do limite (gauge para alertas). */
const STUCK_MINUTES = Math.max(5, parseInt(process.env.METRICS_STUCK_ORDER_MINUTES || '10', 10));

function countStuckOrders(db) {
    const cutoff = new Date(Date.now() - STUCK_MINUTES * 60 * 1000).toISOString();

    let stuckPaid = 0;
    let stuckDelivering = 0;
    let waitingPayment = 0;
    let pendingDelivery = 0;

    try {
        stuckPaid =
            db.prepare(
                `SELECT COUNT(*) as c FROM orders WHERE status = 'PAID' AND (paid_at IS NULL OR paid_at < ?)`
            ).get(cutoff)?.c || 0;
    } catch { /* coluna paid_at pode variar */ }

    try {
        stuckDelivering =
            db.prepare(
                `SELECT COUNT(*) as c FROM orders WHERE status = 'DELIVERING' AND updated_at < ?`
            ).get(cutoff)?.c || 0;
    } catch { /* ignore */ }

    try {
        waitingPayment =
            db.prepare(`SELECT COUNT(*) as c FROM orders WHERE status = 'WAITING_PAYMENT'`).get()?.c || 0;
    } catch { /* ignore */ }

    try {
        pendingDelivery =
            db.prepare(`SELECT COUNT(*) as c FROM orders WHERE status = 'PAID'`).get()?.c || 0;
    } catch { /* ignore */ }

    return { stuckPaid, stuckDelivering, waitingPayment, pendingDelivery, stuckMinutes: STUCK_MINUTES };
}

module.exports = { countStuckOrders, STUCK_MINUTES };
