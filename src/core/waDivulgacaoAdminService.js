'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const { connect: dbConnect } = require('../../config/database-sqlite');
const WaDivulgacaoConfig = require('./waDivulgacaoConfig');
const { getWaDivulgacaoLoginService } = require('./waDivulgacaoLoginService');
const { ensureWaDivulgacaoProducts } = require('./waDivulgacaoProductService');

const PLAN_WHERE = `(
    plan_name LIKE 'Hanork Div%'
    OR plan_name LIKE 'WA Divulgação%'
    OR plan_name LIKE '%Zap PRO%'
)`;

function listActiveSubscriptions(limit = 15, offset = 0) {
    const db = dbConnect();
    if (!db) return { rows: [], total: 0 };
    const total =
        db
            .prepare(
                `SELECT COUNT(*) AS n FROM subscriptions
                 WHERE ${PLAN_WHERE}
                 AND datetime(replace(substr(next_payment_date, 1, 19), 'T', ' ')) > datetime('now')`
            )
            .get()?.n || 0;
    const rows =
        db
            .prepare(
                `SELECT s.*, u.telegram_id AS user_tg, u.username, u.first_name
                 FROM subscriptions s
                 LEFT JOIN users u ON u.id = s.user_id
                 WHERE ${PLAN_WHERE}
                 AND datetime(replace(substr(next_payment_date, 1, 19), 'T', ' ')) > datetime('now')
                 ORDER BY s.next_payment_date ASC
                 LIMIT ? OFFSET ?`
            )
            .all(limit, offset) || [];
    return { rows, total };
}

function getGlobalStats() {
    const db = dbConnect();
    if (!db) return null;

    const active =
        db
            .prepare(
                `SELECT COUNT(*) AS n FROM subscriptions
                 WHERE ${PLAN_WHERE}
                 AND datetime(replace(substr(next_payment_date, 1, 19), 'T', ' ')) > datetime('now')`
            )
            .get()?.n || 0;

    const mrr =
        db
            .prepare(
                `SELECT COALESCE(SUM(plan_value), 0) AS v FROM subscriptions
                 WHERE ${PLAN_WHERE}
                 AND status = 'active'
                 AND datetime(replace(substr(next_payment_date, 1, 19), 'T', ' ')) > datetime('now')`
            )
            .get()?.v || 0;

    const paidTotal =
        db
            .prepare(`SELECT COALESCE(SUM(total_paid), 0) AS v FROM subscriptions WHERE ${PLAN_WHERE}`)
            .get()?.v || 0;

    let workersOnline = 0;
    let workersConnected = 0;
    try {
        const base = path.join(os.homedir(), '.hanork', 'wa-users');
        if (fs.existsSync(base)) {
            for (const dir of fs.readdirSync(base)) {
                const stateFile = path.join(base, dir, 'ipc', 'state.json');
                if (!fs.existsSync(stateFile)) continue;
                try {
                    const st = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
                    if (st?.ipcOnline) workersOnline += 1;
                    if (st?.connected) workersConnected += 1;
                } catch {
                    /* ignore */
                }
            }
        }
    } catch {
        /* ignore */
    }

    return {
        active,
        mrr: Number(mrr) || 0,
        paidTotal: Number(paidTotal) || 0,
        workersOnline,
        workersConnected,
        watermark: WaDivulgacaoConfig.watermarkDefault,
    };
}

function parsePlanDaysFromSub(sub) {
    if (!sub) return 1;
    const bc = String(sub.billing_cycle || '').match(/(\d+)/);
    if (bc) return Math.max(1, parseInt(bc[1], 10) || 1);
    const pn = String(sub.plan_name || '').match(/(\d+)\s*dia/i);
    if (pn) return Math.max(1, parseInt(pn[1], 10) || 1);
    return 1;
}

function getLastWaDivOrder(userId) {
    const db = dbConnect();
    if (!db || !userId) return null;
    return (
        db
            .prepare(
                `SELECT o.id, o.total, o.paid_at, o.payment_method, o.status, o.created_at
                 FROM orders o
                 WHERE o.user_id = ?
                 AND o.status IN ('PAID', 'DELIVERED', 'DELIVERING')
                 AND EXISTS (
                     SELECT 1 FROM order_items oi
                     JOIN products p ON p.id = oi.product_id
                     WHERE oi.order_id = o.id
                     AND (
                         p.category = 'wa_divulgacao'
                         OR p.description LIKE '%WA_PLAN_DAYS=%'
                         OR p.name LIKE '%Hanork Div%'
                     )
                 )
                 ORDER BY COALESCE(o.paid_at, o.created_at) DESC
                 LIMIT 1`
            )
            .get(userId) || null
    );
}

function listRevokedSubscriptions(limit = 8, offset = 0) {
    const db = dbConnect();
    if (!db) return { rows: [], total: 0 };
    const total =
        db
            .prepare(
                `SELECT COUNT(*) AS n FROM subscriptions
                 WHERE ${PLAN_WHERE}
                 AND status = 'cancelled'
                 AND cancelled_at IS NOT NULL
                 AND datetime(cancelled_at) > datetime('now', '-30 days')`
            )
            .get()?.n || 0;
    const rows =
        db
            .prepare(
                `SELECT s.*, u.telegram_id AS user_tg, u.username, u.first_name
                 FROM subscriptions s
                 LEFT JOIN users u ON u.id = s.user_id
                 WHERE ${PLAN_WHERE}
                 AND s.status = 'cancelled'
                 AND s.cancelled_at IS NOT NULL
                 AND datetime(s.cancelled_at) > datetime('now', '-30 days')
                 ORDER BY s.cancelled_at DESC
                 LIMIT ? OFFSET ?`
            )
            .all(limit, offset) || [];
    return { rows, total };
}

function findSubscriptionById(subId) {
    const db = dbConnect();
    if (!db) return null;
    return (
        db
            .prepare(
                `SELECT s.*, u.telegram_id AS user_tg, u.username, u.first_name
                 FROM subscriptions s
                 LEFT JOIN users u ON u.id = s.user_id
                 WHERE s.id = ? AND ${PLAN_WHERE}`
            )
            .get(subId) || null
    );
}

function buildSubscriberDetail(sub) {
    if (!sub) return null;
    const tg = sub.user_tg || sub.telegram_id || '?';
    const order = getLastWaDivOrder(sub.user_id);
    const days = parsePlanDaysFromSub(sub);
    const next = sub.next_payment_date
        ? new Date(sub.next_payment_date).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
        : '—';
    const cancelled = sub.cancelled_at
        ? new Date(sub.cancelled_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
        : null;
    const lastPay = sub.last_payment_date
        ? new Date(sub.last_payment_date).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
        : '—';
    const username = sub.username ? `@${String(sub.username).replace(/^@/, '')}` : null;
    const name = sub.first_name ? String(sub.first_name).trim() : null;
    const orderRef = order?.id ? String(order.id).slice(-8) : null;
    return {
        subId: sub.id,
        userId: sub.user_id,
        telegramId: tg,
        username,
        displayName: name,
        planName: sub.plan_name,
        planDays: days,
        planValue: Number(sub.plan_value) || 0,
        totalPaid: Number(sub.total_paid) || 0,
        totalPayments: Number(sub.total_payments) || 0,
        status: sub.status,
        billingCycle: sub.billing_cycle,
        validUntil: next,
        lastPayment: lastPay,
        cancelledAt: cancelled,
        orderId: order?.id || null,
        orderRef,
        orderTotal: order ? Number(order.total) : null,
        orderPaidAt: order?.paid_at || order?.created_at || null,
    };
}

function restoreSubscription(subId) {
    const db = dbConnect();
    if (!db) return { ok: false, reason: 'no_db' };
    const sub = findSubscriptionById(subId);
    if (!sub) return { ok: false, reason: 'not_found' };
    const days = parsePlanDaysFromSub(sub);
    const order = getLastWaDivOrder(sub.user_id);
    let nextExpr = `datetime('now', '+${days} days')`;
    if (order) {
        const paidAt = order.paid_at || order.created_at;
        if (paidAt) {
            const expiry = new Date(String(paidAt).replace(' ', 'T'));
            if (!Number.isNaN(expiry.getTime())) {
                expiry.setDate(expiry.getDate() + days);
                if (expiry > new Date()) {
                    nextExpr = `'${expiry.toISOString().slice(0, 19).replace('T', ' ')}'`;
                }
            }
        }
    }
    const r = db
        .prepare(
            `UPDATE subscriptions SET
                status = 'active',
                cancelled_at = NULL,
                next_payment_date = ${nextExpr},
                last_payment_date = COALESCE(last_payment_date, datetime('now'))
             WHERE id = ? AND ${PLAN_WHERE}`
        )
        .run(subId);
    if (r.changes > 0 && sub.user_id) {
        db.prepare('UPDATE users SET is_premium = 1 WHERE id = ?').run(sub.user_id);
    }
    return r.changes > 0 ? { ok: true, days } : { ok: false, reason: 'update_failed' };
}

function revokeSubscription(subId) {
    const db = dbConnect();
    if (!db) return false;
    const r = db
        .prepare(
            `UPDATE subscriptions SET status = 'cancelled', cancelled_at = datetime('now'),
             next_payment_date = datetime('now') WHERE id = ? AND ${PLAN_WHERE}`
        )
        .run(subId);
    return r.changes > 0;
}

function extendSubscription(subId, days = 7) {
    const db = dbConnect();
    if (!db) return false;
    const d = Math.min(60, Math.max(1, Number(days) || 7));
    const r = db
        .prepare(
            `UPDATE subscriptions SET status = 'active',
             next_payment_date = datetime(
               replace(substr(
                 CASE WHEN datetime(replace(substr(next_payment_date,1,19),'T',' ')) > datetime('now')
                      THEN next_payment_date ELSE datetime('now') END, 1, 19), 'T', ' '
               ), '+${d} days'
             )
             WHERE id = ? AND ${PLAN_WHERE}`
        )
        .run(subId);
    return r.changes > 0;
}

async function forceDisconnect(telegramId) {
    const login = getWaDivulgacaoLoginService();
    return login.disconnect(telegramId);
}

function readUserConnection(telegramId) {
    try {
        return getWaDivulgacaoLoginService().readConnectionState(telegramId);
    } catch {
        return null;
    }
}

function syncPlans() {
    return ensureWaDivulgacaoProducts();
}

module.exports = {
    listActiveSubscriptions,
    listRevokedSubscriptions,
    getGlobalStats,
    findSubscriptionById,
    buildSubscriberDetail,
    getLastWaDivOrder,
    parsePlanDaysFromSub,
    revokeSubscription,
    restoreSubscription,
    extendSubscription,
    forceDisconnect,
    readUserConnection,
    syncPlans,
};
