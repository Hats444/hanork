require('dotenv').config();
const { connect } = require('../src/config/database-sqlite');

connect();
const db = connect();

console.log('=== Recent virtuo orders ===');
const orders = db
    .prepare(
        `SELECT vo.id, vo.hanork_order_id, vo.virtuo_service_id, vo.service_code, vo.service_name,
                vo.country_name, vo.status, vo.virtuo_order_id, vo.phone, vo.created_at,
                vs.service_code AS catalog_code, vs.service_name AS catalog_name
         FROM virtuo_orders vo
         LEFT JOIN virtuo_services vs ON vs.id = vo.virtuo_service_id
         ORDER BY vo.id DESC LIMIT 15`
    )
    .all();
for (const o of orders) {
    const mismatch = o.service_code !== o.catalog_code ? ' *** MISMATCH ***' : '';
    console.log(
        `#${o.id} ${o.service_code}/${o.country_name} status=${o.status} catalog=${o.catalog_code} virtuo_id=${o.virtuo_order_id || '-'}${mismatch}`
    );
}

console.log('\n=== Mismatched orders (all) ===');
const bad = db
    .prepare(
        `SELECT vo.id, vo.service_code, vs.service_code AS catalog_code, vo.country_name
         FROM virtuo_orders vo
         JOIN virtuo_services vs ON vs.id = vo.virtuo_service_id
         WHERE vo.service_code != vs.service_code`
    )
    .all();
console.log(JSON.stringify(bad, null, 2));
