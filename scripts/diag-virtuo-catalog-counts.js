#!/usr/bin/env node
'use strict';
require('dotenv').config();
const { connect } = require('../src/config/database-sqlite');
const VirtuoApiClient = require('../src/modules/virtuo/providers/virtuoApiClient');

connect();
const db = connect();

const stats = db
    .prepare(
        `SELECT service_code,
            COUNT(*) total,
            SUM(CASE WHEN active=1 AND available>0 THEN 1 ELSE 0 END) sellable,
            SUM(CASE WHEN available>0 THEN 1 ELSE 0 END) with_stock,
            SUM(CASE WHEN active=1 THEN 1 ELSE 0 END) active_only
         FROM virtuo_services GROUP BY service_code ORDER BY sellable DESC`
    )
    .all();

console.log('=== DB por servico (bot mostra sellable) ===');
console.table(stats);

const blocks = db.prepare("SELECT COUNT(*) c FROM kv_store WHERE key LIKE 'virtuo_block:%'").get();
console.log('Bloqueios virtuo_block:', blocks.c);

const inactiveWithStock = db
    .prepare(
        `SELECT service_code, COUNT(*) c FROM virtuo_services
         WHERE available > 0 AND active = 0 GROUP BY service_code`
    )
    .all();
console.log('\n=== Com estoque na API mas active=0 (bloqueados) ===');
console.table(inactiveWithStock);

(async () => {
    const resp = await VirtuoApiClient.getPrices('wa', undefined, 1);
    const prices = resp.data?.prices || [];
    const withAvail = prices.filter((p) => Number(p.available) > 0);
    console.log('\n=== API /prices wa ===');
    console.log('Total paises na API:', prices.length);
    console.log('Com available>0:', withAvail.length);

    const inDb = db.prepare("SELECT country_id, country_name, active, available FROM virtuo_services WHERE service_code='wa'").all();
    const dbMap = new Map(inDb.map((r) => [Number(r.country_id), r]));
    let apiNotInDb = 0;
    let apiInDbInactive = 0;
    for (const p of withAvail) {
        const cid = Number(p.countryId ?? p.id);
        const row = dbMap.get(cid);
        if (!row) apiNotInDb++;
        else if (!row.active) apiInDbInactive++;
    }
    console.log('API com estoque mas ausente no DB:', apiNotInDb);
    console.log('API com estoque no DB mas inactive:', apiInDbInactive);
})();
