'use strict';

const logger = require('../config/logger');
const dbRaw = require('../config/database-sqlite').connect;

function db() {
    return dbRaw();
}

function ensureWallet(userId) {
    db().prepare(
        `INSERT OR IGNORE INTO user_wallet (user_id, balance, updated_at) VALUES (?, 0, datetime('now'))`
    ).run(userId);
}

function getBalance(userId) {
    if (!userId) return 0;
    ensureWallet(userId);
    const row = db().prepare('SELECT balance FROM user_wallet WHERE user_id = ?').get(userId);
    return Math.max(0, Number(row?.balance) || 0);
}

async function getBalanceByTelegramId(telegramId) {
    try {
        const { prisma } = require('../config/database-sqlite');
        const user = await prisma.user.findUnique({ where: { telegram_id: String(telegramId) } });
        if (!user) return 0;
        return getBalance(user.id);
    } catch {
        return 0;
    }
}

function appendLedger(userId, { orderId = null, amount, direction, reason, balanceAfter }) {
    db().prepare(
        `INSERT INTO user_wallet_ledger (user_id, order_id, amount, direction, reason, balance_after)
         VALUES (?, ?, ?, ?, ?, ?)`
    ).run(userId, orderId, amount, direction, reason || null, balanceAfter);
}

function credit(userId, amount, { orderId = null, reason = 'credit', idempotencyKey = null } = {}) {
    const val = Number(amount);
    if (!userId || !Number.isFinite(val) || val <= 0) {
        return { ok: false, reason: 'invalid_amount' };
    }

    if (idempotencyKey) {
        const existing = db().prepare('SELECT key FROM kv_store WHERE key = ?').get(idempotencyKey);
        if (existing) return { ok: true, skipped: true, reason: 'already_credited' };
    }

    ensureWallet(userId);
    const tx = db().transaction(() => {
        const row = db().prepare('SELECT balance FROM user_wallet WHERE user_id = ?').get(userId);
        const before = Number(row?.balance) || 0;
        const after = Math.round((before + val) * 100) / 100;
        db().prepare(
            `UPDATE user_wallet SET balance = ?, updated_at = datetime('now') WHERE user_id = ?`
        ).run(after, userId);
        appendLedger(userId, {
            orderId,
            amount: val,
            direction: 'credit',
            reason,
            balanceAfter: after,
        });
        if (idempotencyKey) {
            db().prepare(
                `INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, datetime('now'))`
            ).run(idempotencyKey, String(Date.now()));
        }
        return { before, after };
    });

    const { before, after } = tx();
    logger.info('[Wallet] credit', { userId, amount: val, orderId, reason, balance: after });
    return { ok: true, amount: val, balanceBefore: before, balanceAfter: after };
}

function reserve(userId, amount) {
    const val = Number(amount);
    if (!userId || !Number.isFinite(val) || val <= 0) return false;
    ensureWallet(userId);
    const result = db().prepare(
        'UPDATE user_wallet SET balance = balance - ?, updated_at = datetime(\'now\') WHERE user_id = ? AND balance >= ?'
    ).run(val, userId, val);
    return result.changes >= 1;
}

function cancelReserve(userId, amount) {
    const val = Number(amount);
    if (!userId || !Number.isFinite(val) || val <= 0) return false;
    ensureWallet(userId);
    db().prepare(
        'UPDATE user_wallet SET balance = balance + ?, updated_at = datetime(\'now\') WHERE user_id = ?'
    ).run(val, userId);
    appendLedger(userId, {
        amount: val,
        direction: 'credit',
        reason: 'reserve_cancel',
        balanceAfter: getBalance(userId),
    });
    logger.info('[Wallet] reserve cancel', { userId, amount: val });
    return true;
}

function confirmSpend(userId, amount, orderId = null) {
    const val = Number(amount);
    if (!userId || !Number.isFinite(val) || val <= 0) return false;
    appendLedger(userId, {
        orderId,
        amount: val,
        direction: 'debit',
        reason: 'order_payment',
        balanceAfter: getBalance(userId),
    });
    logger.info('[Wallet] spend confirmed', { userId, amount: val, orderId });
    return true;
}

function listRecentLedger(userId, limit = 8) {
    return db()
        .prepare(
            `SELECT order_id, amount, direction, reason, balance_after, created_at
             FROM user_wallet_ledger WHERE user_id = ? ORDER BY id DESC LIMIT ?`
        )
        .all(userId, limit);
}

module.exports = {
    getBalance,
    getBalanceByTelegramId,
    credit,
    reserve,
    cancelReserve,
    confirmSpend,
    listRecentLedger,
};
