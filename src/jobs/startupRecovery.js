'use strict';

/**
 * M5 parcial (B3) — recovery financeiro no boot.
 * Limites e timeouts evitam saturar MP/SQLite e travar comandos Telegram.
 */
function resolveDbRaw(deps) {
    if (deps?.dbRaw) return deps.dbRaw;
    try {
        return require('../config/database-sqlite').connect;
    } catch {
        return null;
    }
}

function withTimeout(promise, ms, label) {
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            setTimeout(() => reject(new Error(`timeout ${label} (${ms}ms)`)), ms);
        }),
    ]);
}

async function recoverPendingPayments(deps) {
    const {
        prisma,
        MP,
        bot,
        logger,
        SafeWebhookHandler,
        SafeDeliveryService,
        mpAmountMatchesOrder,
        webhookPaymentDedup,
        deferBackground,
    } = deps;

    const dbRaw = resolveDbRaw(deps);
    const db = dbRaw;

    try {
        const { recoverPendingMpWebhooks } = require('../modules/payment/mpWebhookHandler');
        await recoverPendingMpWebhooks({
            bot,
            prisma,
            logger,
            webhookPaymentDedup,
            deferBackground: deferBackground || (async (_n, fn) => fn()),
        });
    } catch (e) {
        logger.warn('[WEBHOOK] recover pending receipts:', e.message);
    }

    const staleDays = Math.max(1, parseInt(process.env.RECOVER_STALE_DAYS || '14', 10));
    const maxOrders = Math.max(1, parseInt(process.env.RECOVER_MAX_ORDERS || '12', 10));
    const orderTimeoutMs = Math.max(5000, parseInt(process.env.RECOVER_ORDER_TIMEOUT_MS || '35000', 10));
    const concurrency = Math.min(2, Math.max(1, parseInt(process.env.RECOVER_CONCURRENCY || '2', 10)));

    try {
        const allWaiting = await prisma.order.findMany({
            where: { status: 'WAITING_PAYMENT' },
            orderBy: { created_at: 'desc' },
        });

        if (!allWaiting.length) {
            await finalizeRecovery({ SafeWebhookHandler, SafeDeliveryService, logger, bot, dbRaw: db });
            return;
        }

        const cutoff = new Date(Date.now() - staleDays * 86400000).toISOString();
        const stale = allWaiting.filter((o) => o.created_at && o.created_at < cutoff);
        if (stale.length) {
            logger.info(
                `[RECOVER] ${stale.length} pedido(s) WAITING_PAYMENT expirados (>${staleDays}d) — marcando FAILED`
            );
            for (const order of stale) {
                try {
                    await prisma.order.update({ where: { id: order.id }, data: { status: 'FAILED' } });
                } catch (e) {
                    logger.warn(`[RECOVER] stale order ${order.id}: ${e.message}`);
                }
            }
        }

        const orders = allWaiting.filter((o) => !o.created_at || o.created_at >= cutoff).slice(0, maxOrders);
        const skipped = allWaiting.length - stale.length - orders.length;

        if (skipped > 0) {
            logger.info(`[RECOVER] ${skipped} pedido(s) adiados para próximo boot (limite ${maxOrders})`);
        }

        if (orders.length) {
            logger.info(`[RECOVER] Verificando ${orders.length} pedido(s) aguardando pagamento…`);
            const CONCURRENCY = concurrency;
            let confirmed = 0;
            for (let i = 0; i < orders.length; i += CONCURRENCY) {
                const batch = orders.slice(i, i + CONCURRENCY);
                await Promise.all(
                    batch.map(async (order) => {
                        try {
                            await withTimeout(
                                (async () => {
                                    const ref = order.external_reference || order.id;
                                    let paid = await MP.search(ref, { lite: true });
                                    if ((!paid || paid.status !== 'approved') && order.payment_method === 'card') {
                                        try {
                                            const dbConnect = require('../config/database-sqlite').connect;
                                            const row = dbConnect()
                                                .prepare('SELECT value FROM kv_store WHERE key=?')
                                                .get(`order_mp_pref:${order.id}`);
                                            if (row?.value && MP.searchByPreference) {
                                                paid = await MP.searchByPreference(row.value, { lite: true });
                                            }
                                        } catch {
                                            /* ignore */
                                        }
                                    }
                                    if (!paid || paid.status !== 'approved') return;
                                    if (!mpAmountMatchesOrder(paid, order)) {
                                        logger.warn(`[RECOVER] Valor divergente pedido ${order.id}`);
                                        return;
                                    }
                                    const result = await SafeWebhookHandler.processPayment(
                                        String(paid.id),
                                        {
                                            external_reference: ref,
                                            status: 'approved',
                                            transaction_amount: paid.transaction_amount,
                                            payment_method_id: paid.payment_method_id,
                                        },
                                        bot
                                    );
                                    if (result.processed) confirmed++;
                                })(),
                                orderTimeoutMs,
                                `order-${order.id}`
                            );
                        } catch (e) {
                            logger.warn(`[RECOVER] order ${order.id}: ${e?.message || e?.code || String(e)}`);
                        }
                    })
                );
                if (i + CONCURRENCY < orders.length) {
                    await new Promise((r) => setTimeout(r, 200));
                }
            }
            logger.info(`[RECOVER] Verificação concluída${confirmed ? ` · ${confirmed} confirmado(s)` : ''}`);
        }

        await finalizeRecovery({ SafeWebhookHandler, SafeDeliveryService, logger, bot, dbRaw: db });
    } catch (e) {
        logger.warn('recoverPendingPayments:', e.message);
    }
}

async function finalizeRecovery({ SafeWebhookHandler, SafeDeliveryService, logger, bot, dbRaw }) {
    try {
        const stuckPaid = await SafeWebhookHandler.recoverStuckPayments();
        if (stuckPaid > 0) logger.info(`[RECOVER] ${stuckPaid} pedido(s) PAID reagendados para entrega`);
        const stuckDel = await SafeDeliveryService.recoverStuckDeliveries();
        if (stuckDel > 0) logger.info(`[RECOVER] ${stuckDel} entrega(s) travada(s) marcadas para retry`);
    } catch (e) {
        logger.warn('[RECOVER] finalize:', e.message);
    }

    try {
        const posted = await recoverMissingSalesReferences({ bot, dbRaw, logger });
        if (posted > 0) {
            logger.info('[RECOVER] referências republicadas no canal', { count: posted });
        }
    } catch (e) {
        logger.warn('[RECOVER] sales ref:', e.message);
    }
}

async function recoverMissingSalesReferences({ bot, dbRaw: dbRawIn, logger }) {
    const { isSalesRefChannelEnabled } = require('../config/salesReferenceChannel');
    if (!isSalesRefChannelEnabled() || !bot?.telegram) return 0;

    const dbRaw = dbRawIn || resolveDbRaw({});
    const { SalesReferenceChannelService } = require('../services/SalesReferenceChannelService');
    const service = new SalesReferenceChannelService({ bot, dbRaw });
    if (!service.isEnabled()) return 0;

    const hours = Math.max(6, parseInt(process.env.SALES_REF_RECOVER_HOURS || '72', 10));
    const dbFn = typeof dbRaw === 'function' ? dbRaw : null;
    const db = dbFn ? dbFn() : dbRaw;
    if (!db?.prepare) return 0;
    const rows = db
        .prepare(
            `SELECT o.id, o.total, o.payment_id, o.payment_method
             FROM orders o
             LEFT JOIN kv_store k ON k.key = 'sales_ref_posted:' || o.id
             WHERE o.status IN ('PAID', 'DELIVERED', 'DELIVERING')
               AND o.paid_at IS NOT NULL
               AND o.paid_at >= datetime('now', ?)
               AND k.key IS NULL
             ORDER BY o.paid_at ASC
             LIMIT 25`
        )
        .all(`-${hours} hours`);

    if (!rows.length) return 0;

    logger.info('[RECOVER] vendas pagas sem post no canal de referências', { count: rows.length, hours });

    let posted = 0;
    for (const row of rows) {
        try {
            const r = await service.postConfirmedSale({
                orderId: row.id,
                total: row.total,
                paymentId: row.payment_id,
            });
            if (r.ok && !r.skipped) posted++;
            else if (!r.ok && !r.skipped) {
                logger.warn('[RECOVER] sales ref falhou', { orderId: row.id, detail: r.error });
            }
        } catch (e) {
            logger.warn('[RECOVER] sales ref exceção', { orderId: row.id, detail: e.message });
        }
        await new Promise((r) => setTimeout(r, 350));
    }
    return posted;
}

module.exports = { recoverPendingPayments, recoverMissingSalesReferences };
