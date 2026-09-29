'use strict';

const logger = require('../../config/logger');

/**
 * Kit inicial para nova loja SaaS: cupom de boas-vindas + mensagem no log.
 */
function applyStarterKit(tenantId) {
    const db = require('../../config/database-sqlite').connect();
    const tid = Number(tenantId);
    if (!tid) return { coupon: false };

    let coupon = false;
    try {
        const code = `BV${tid}`;
        const exists = db.prepare('SELECT id FROM coupons WHERE code=?').get(code);
        if (!exists) {
            db.prepare(
                `INSERT INTO coupons (code, type, value, max_uses, min_total, active, tenant_id)
                 VALUES (?, 'percent', 10, 100, 0, 1, ?)`
            ).run(code, tid);
            coupon = true;
        }
    } catch (e) {
        logger.warn('[starterKit] cupom:', e.message);
    }

    logger.info(`[starterKit] tenant=${tid} cupom=${coupon ? 'BEMVINDO10' : 'skip'}`);
    return { coupon };
}

module.exports = { applyStarterKit };
