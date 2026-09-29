require('dotenv').config();
const { connect } = require('../src/config/database-sqlite');
connect();
const rows = connect()
    .prepare(
        `SELECT id, service_code, country_id, country_name, active, available
         FROM virtuo_services
         WHERE country_name LIKE '%Argentina%' OR country_name LIKE '%Ecuador%'
            OR id IN (38, 102, 105)
         ORDER BY id`
    )
    .all();
console.log(JSON.stringify(rows, null, 2));
