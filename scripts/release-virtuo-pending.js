#!/usr/bin/env node
'use strict';

/**
 * Libera pedido Virtuo preso (paid/waiting_sms) para um telegram_id.
 * Uso: node scripts/release-virtuo-pending.js <telegram_id>
 */
const telegramId = String(process.argv[2] || '').trim();
if (!telegramId) {
    console.error('Uso: node scripts/release-virtuo-pending.js <telegram_id>');
    process.exit(1);
}

const VirtuoOrderRepository = require('../src/modules/virtuo/repositories/virtuoOrderRepository');
const VirtuoFulfillmentService = require('../src/modules/virtuo/services/fulfillmentService');
const { reconcileTelegramPending } = require('../src/modules/virtuo/services/virtuoPendingReconcileService');

(async () => {
    const before = VirtuoOrderRepository.findPendingByTelegram(telegramId);
    console.log('before:', before ? { id: before.id, status: before.status, virtuo: before.virtuo_order_id } : null);

    const synced = await reconcileTelegramPending(telegramId, null);
    console.log('sync:', { stillPending: synced.stillPending, status: synced.order?.status });

    if (synced.stillPending && synced.order) {
        const r = await VirtuoFulfillmentService.cancelByUser(synced.order, null, { telegramId });
        console.log('cancel:', r);
    }

    const after = VirtuoOrderRepository.findPendingByTelegram(telegramId);
    console.log('after:', after ? { id: after.id, status: after.status } : null);
    process.exit(after ? 1 : 0);
})().catch((e) => {
    console.error(e);
    process.exit(2);
});
