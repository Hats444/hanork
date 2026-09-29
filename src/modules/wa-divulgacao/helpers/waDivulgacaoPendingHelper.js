'use strict';

const { isWaDivulgacaoProduct } = require('../waDivulgacaoPlans');

function isWaDivulgacaoHanorkOrder(orderId) {
    if (!orderId) return false;
    const { connect: dbConnect } = require('../../../config/database-sqlite');
    const db = dbConnect();
    if (!db) return false;
    const rows =
        db
            .prepare(
                `SELECT p.category, p.description, p.name, p.is_subscription
                 FROM order_items oi
                 JOIN products p ON p.id = oi.product_id
                 WHERE oi.order_id = ?`
            )
            .all(orderId) || [];
    return rows.some((r) => isWaDivulgacaoProduct(r));
}

module.exports = { isWaDivulgacaoHanorkOrder };
