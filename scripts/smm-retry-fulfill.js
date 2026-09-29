#!/usr/bin/env node
'use strict';
/** Reenvia fulfill de pedido SMM pago mas marcado failed (ex. compra segura bug). */
const path = require('path');
process.chdir(path.join(__dirname, '..'));
require('../src/config/env');

const orderId = process.argv[2];
if (!orderId) {
    console.error('Uso: node scripts/smm-retry-fulfill.js <hanork_order_id>');
    process.exit(1);
}

const { connect } = require('../src/config/database-sqlite');
const SmmFulfillmentService = require('../src/modules/smm/services/fulfillmentService');
const SmmOrderRepository = require('../src/modules/smm/repositories/smmOrderRepository');

(async () => {
    connect();
    const row = SmmOrderRepository.findByHanorkOrderId(orderId);
    if (!row) {
        console.error('smm_order não encontrado');
        process.exit(1);
    }
    if (row.provider_order_id) {
        console.log('Já enviado:', row.provider_order_id);
        process.exit(0);
    }
    const db = connect();
    db.prepare("UPDATE smm_orders SET status = 'paid', updated_at = datetime('now') WHERE id = ?").run(row.id);
    const bot = global.botInstance || { telegram: { sendMessage: async () => {} } };
    const r = await SmmFulfillmentService.fulfillHanorkOrder(orderId, bot);
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
