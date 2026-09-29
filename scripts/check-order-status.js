#!/usr/bin/env node
'use strict';

const path = require('path');
process.chdir(path.join(__dirname, '..'));
require('../src/config/env');

const { connect } = require('../src/config/database-sqlite');
const { mapProviderStatus } = require('../src/modules/smm/constants/orderStatuses');

const providerOrderId = process.argv[2] || '1568846';
const orderHint = process.argv[3] || '2e572033';

(async () => {
    connect();
    const db = connect();

    const row = db.prepare(`
        SELECT o.id, o.status AS ostatus, o.total, o.paid_at, o.user_id,
               s.id AS smm_id, s.status AS smm_status, s.provider_order_id,
               s.quantity, s.link, s.service_id, s.updated_at
        FROM orders o
        JOIN smm_orders s ON s.hanork_order_id = o.id
        WHERE s.provider_order_id = ? OR o.id LIKE ?
    `).get(providerOrderId, `%${orderHint}%`);

    console.log('--- DB ---');
    console.log(JSON.stringify(row, null, 2));

    if (!row?.provider_order_id) {
        process.exit(1);
    }

    const { getProvider } = require('../src/modules/smm/providers/providerRegistry');
    const prov = getProvider();
    const raw = await prov.getOrderStatus(row.provider_order_id);
    const mapped = mapProviderStatus(raw);

    console.log('--- PROVIDER ---');
    console.log(JSON.stringify(raw, null, 2));
    console.log('--- MAPPED STATUS ---', mapped);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
