'use strict';

const { connect: dbConnect } = require('../../config/database-sqlite');
const logger = require('../../config/logger');
const WaDivulgacaoConfig = require('./waDivulgacaoConfig');
const { listPlans } = require('./waDivulgacaoPlans');

function ensureWaDivulgacaoProducts() {
    const db = dbConnect();
    if (!db) return { upserted: 0 };

    let upserted = 0;
    for (const plan of listPlans()) {
        const existing = db
            .prepare(
                `SELECT id FROM products
                 WHERE is_subscription = 1 AND category = ? AND description LIKE ?`
            )
            .get(WaDivulgacaoConfig.productCategory, `%WA_PLAN_DAYS=${plan.days}%`);

        if (existing?.id) {
            db.prepare(
                `UPDATE products SET name = ?, price = ?, description = ?, active = 1
                 WHERE id = ?`
            ).run(plan.name, plan.price, plan.description, existing.id);
            upserted++;
            continue;
        }

        db.prepare(
            `INSERT INTO products (name, price, description, category, stock, active, is_subscription)
             VALUES (?, ?, ?, ?, 999, 1, 1)`
        ).run(plan.name, plan.price, plan.description, WaDivulgacaoConfig.productCategory);
        upserted++;
    }

    if (upserted > 0) {
        logger.info('[WaDivulgacao] Planos sincronizados no catálogo', { count: upserted });
    }
    return { upserted };
}

module.exports = { ensureWaDivulgacaoProducts };
