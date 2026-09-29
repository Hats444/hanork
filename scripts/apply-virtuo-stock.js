'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const {
    seedBlocksFromFailedOrders,
    reconcileAllFeaturedStock,
    reconcileCatalogFull,
    reconcileCatalogBatch,
} = require('../src/modules/virtuo/services/virtuoStockService');
const { FEATURED_SERVICES } = require('../src/modules/virtuo/constants/featuredServices');
const { connect } = require('../src/config/database-sqlite');

async function main() {
    connect();
    const full = process.argv.includes('--full');
    const seeded = await seedBlocksFromFailedOrders();
    const stock = await reconcileAllFeaturedStock(FEATURED_SERVICES.map((f) => f.code));
    const reconcile = full
        ? await reconcileCatalogFull({ batchSize: 25 })
        : await reconcileCatalogBatch(50);

    const stats = connect()
        .prepare('SELECT COUNT(*) as total, SUM(CASE WHEN active=1 AND available>0 THEN 1 ELSE 0 END) as sellable FROM virtuo_services')
        .get();

    console.log(JSON.stringify({ seeded, stock, reconcile, stats }, null, 2));
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
