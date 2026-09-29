'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { connect } = require('../src/config/database-sqlite');
const db = connect();
const rows = db.prepare('SELECT id, country_id, country_name, service_code FROM virtuo_services WHERE id BETWEEN 35 AND 45 OR country_id BETWEEN 35 AND 45 ORDER BY id').all();
console.log(JSON.stringify(rows, null, 2));
