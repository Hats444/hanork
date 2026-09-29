'use strict';

const logger = require('../../../config/logger');
const { connect } = require('../../../config/database-sqlite');
const SmmConfig = require('../smmConfig');
const { applyFailureCredit } = require('../services/smmFailureRecoveryService');

function stuckMinutes() {
    return Math.max(15, Number(SmmConfig.stuckFulfillMinutes ?? 45));
}

function listStuckPaidWithoutProvider(limit = 25) {
    const mins = stuckMinutes();
    return connect()
        .prepare(
            `SELECT s.* FROM smm_orders s
             INNER JOIN orders o ON o.id = s.hanork_order_id
             WHERE s.provider_order_id IS NULL
               AND s.status IN ('paid', 'pending', 'awaiting_payment')
               AND o.status IN ('PAID', 'DELIVERING')
               AND datetime(COALESCE(s.updated_at, s.created_at)) < datetime('now', ? || ' minutes')
             ORDER BY s.updated_at ASC
             LIMIT ?`
        )
        .all(`-${mins}`, limit);
}

async function runStuckFulfillRecoveryJob(bot) {
    const rows = listStuckPaidWithoutProvider(SmmConfig.stuckFulfillBatchSize ?? 20);
    if (!rows.length) {
        return { checked: 0, recovered: 0, skipped: 0 };
    }

    let recovered = 0;
    let skipped = 0;

    for (const smmOrder of rows) {
        const hanorkOrderId = smmOrder.hanork_order_id;
        if (!hanorkOrderId) {
            skipped++;
            continue;
        }

        if (OrderFailureCreditServiceWasHandled(hanorkOrderId)) {
            skipped++;
            continue;
        }

        try {
            await applyFailureCredit({
                hanorkOrderId,
                smmOrder,
                reason: 'stuck_fulfill_timeout',
                detail: `sem envio ao fornecedor após ${stuckMinutes()} min`,
                bot,
                markFailed: true,
            });
            recovered++;
        } catch (e) {
            logger.warn('[SMM:stuck] recovery falhou', {
                hanorkOrderId,
                smmOrderId: smmOrder.id,
                detail: e.message,
            });
            skipped++;
        }
    }

    if (recovered > 0) {
        logger.info('[SMM:stuck] pedidos recuperados', { recovered, checked: rows.length });
    }

    return { checked: rows.length, recovered, skipped };
}

function OrderFailureCreditServiceWasHandled(orderId) {
    try {
        const OrderFailureCreditService = require('../../../services/OrderFailureCreditService');
        return OrderFailureCreditService.wasCreditHandled(orderId);
    } catch {
        return false;
    }
}

module.exports = { runStuckFulfillRecoveryJob, listStuckPaidWithoutProvider, stuckMinutes };
