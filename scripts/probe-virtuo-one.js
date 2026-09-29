'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const VirtuoApiClient = require('../src/modules/virtuo/providers/virtuoApiClient');
const { connect } = require('../src/config/database-sqlite');
const { probeServiceRow } = require('../src/modules/virtuo/services/virtuoStockService');

async function main() {
    connect();
    const bal = await VirtuoApiClient.getBalance();
    console.log('balance:', JSON.stringify(bal, null, 2));

    const waPrices = await VirtuoApiClient.getPrices('wa', undefined, 1);
    const brRows = (waPrices.data?.prices || []).filter((p) => /brazil/i.test(String(p.countryName || '')));
    console.log('Brazil in /prices:', JSON.stringify(brRows, null, 2));

    for (const row of brRows.slice(0, 1)) {
        const cid = Number(row.countryId ?? row.id);
        const act = await VirtuoApiClient.requestActivation({
            service: 'wa',
            country: cid,
            server: 1,
            maxPrice: Number(row.price) * 1.2,
        });
        console.log('direct activation country', cid, JSON.stringify(act, null, 2));
    }
    const ids = process.argv.slice(2).map(Number).filter(Boolean);
    const db = connect();
    for (const id of ids) {
        const svc = db.prepare('SELECT * FROM virtuo_services WHERE id=?').get(id);
        if (!svc) continue;
        console.log('Probing', svc.service_code, svc.country_name, 'cost', svc.cost_price);
        const r = await probeServiceRow(svc, { force: true });
        console.log(JSON.stringify(r));
        const after = db.prepare('SELECT active, available FROM virtuo_services WHERE id=?').get(id);
        console.log('After:', after, '\n');
    }
}

main().catch((e) => { console.error(e); process.exit(1); });
