'use strict';

/**
 * Republica vendas confirmadas no canal @hanorkinfos.
 * Uso: node scripts/replay-sales-ref.js [--today] [--force] [orderId...]
 */
require('dotenv').config();
const { Telegraf } = require('telegraf');
const { connect } = require('../src/config/database-sqlite');
const db = connect();
const { SalesReferenceChannelService } = require('../src/services/SalesReferenceChannelService');

if (process.env.SALES_REF_REPLAY_ENABLED === '0') {
    console.error('ERRO: SALES_REF_REPLAY_ENABLED=0 — replay desativado em produção.');
    process.exit(1);
}

const args = process.argv.slice(2);
const force = args.includes('--force');
const todayOnly = args.includes('--today');
const yes = args.includes('--yes');
const orderIds = args.filter((a) => !a.startsWith('--'));

if (force && !yes) {
    console.error(
        'ERRO: --force republica no canal mesmo se já postou. Use --force --yes para confirmar.'
    );
    process.exit(1);
}

const token = process.env.TOKEN_TELEGRAM || process.env.BOT_TOKEN;
if (!token) {
    console.error('TOKEN_TELEGRAM ausente');
    process.exit(1);
}

const bot = new Telegraf(token);
const service = new SalesReferenceChannelService({ bot, dbRaw: () => db });

function listOrders() {
    if (orderIds.length) {
        return orderIds.map((id) => db.prepare('SELECT * FROM orders WHERE id = ?').get(id)).filter(Boolean);
    }
    if (todayOnly) {
        return db
            .prepare(
                `SELECT * FROM orders
                 WHERE status IN ('PAID','DELIVERED','DELIVERING')
                   AND status NOT IN ('REFUNDED','FAILED','CANCELLED')
                   AND date(COALESCE(paid_at, created_at)) = date('now', 'localtime')
                 ORDER BY paid_at`
            )
            .all();
    }
    return db
        .prepare(
            `SELECT * FROM orders
             WHERE status IN ('PAID','DELIVERED','DELIVERING')
               AND paid_at >= datetime('now', '-48 hours')
             ORDER BY paid_at DESC
             LIMIT 20`
        )
        .all();
}

(async () => {
    const orders = listOrders();
    if (!orders.length) {
        console.log('Nenhum pedido para republicar.');
        process.exit(0);
    }

    let ok = 0;
    let skip = 0;
    let fail = 0;

    for (const order of orders) {
        if (force) service.clearPostedMark(order.id);
        const r = await service.replayConfirmedSale(order.id, {
            total: order.total,
            paymentId: order.payment_id,
        });
        if (r.ok && !r.skipped) {
            ok++;
            console.log('OK', order.id.slice(-12), order.payment_method, order.total);
        } else if (r.skipped) {
            skip++;
            console.log('SKIP', order.id.slice(-12), r.reason);
        } else {
            fail++;
            console.log('FAIL', order.id.slice(-12), r.error || r.reason);
        }
        await new Promise((res) => setTimeout(res, 500));
    }

    console.log('\nResumo:', { total: orders.length, ok, skip, fail });
    process.exit(fail ? 1 : 0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
