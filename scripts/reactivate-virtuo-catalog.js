#!/usr/bin/env node
'use strict';
require('dotenv').config();
const { connect } = require('../src/config/database-sqlite');
const { FEATURED_SERVICES } = require('../src/modules/virtuo/constants/featuredServices');
const { reactivateAllFromPrices } = require('../src/modules/virtuo/services/virtuoStockService');
const VirtuoServiceRepository = require('../src/modules/virtuo/repositories/virtuoServiceRepository');

async function main() {
    connect();
    const before = VirtuoServiceRepository.countSellable();
    const r = await reactivateAllFromPrices(FEATURED_SERVICES.map((f) => f.code));
    const stats = connect()
        .prepare(
            `SELECT service_code,
                SUM(CASE WHEN active=1 AND available>0 THEN 1 ELSE 0 END) sellable
             FROM virtuo_services GROUP BY service_code ORDER BY service_code`
        )
        .all();
    console.log(JSON.stringify({ before, after: r.sellable, cleared: r.cleared, byService: stats }, null, 2));
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
