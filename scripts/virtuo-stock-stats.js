'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { connect } = require('../src/config/database-sqlite');
const d = connect();
const stats = d.prepare('SELECT COUNT(*) as total, SUM(CASE WHEN active=1 AND available>0 THEN 1 ELSE 0 END) as sellable, SUM(CASE WHEN available>0 THEN 1 ELSE 0 END) as withCatalogStock, SUM(CASE WHEN active=0 AND available>0 THEN 1 ELSE 0 END) as pendingProbe FROM virtuo_services').get();
const byApp = d.prepare('SELECT service_code, COUNT(*) as sellable FROM virtuo_services WHERE active=1 AND available>0 GROUP BY service_code ORDER BY sellable DESC').all();
console.log(JSON.stringify({ stats, byApp }, null, 2));
