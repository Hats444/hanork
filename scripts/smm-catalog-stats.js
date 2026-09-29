#!/usr/bin/env node
'use strict';
const path = require('path');
process.chdir(path.join(__dirname, '..'));
require('../src/config/env');
const { connect } = require('../src/config/database-sqlite');
connect();
const db = connect();
const total = db.prepare('SELECT COUNT(*) as n, SUM(active) as active FROM smm_services').get();
const byType = db.prepare('SELECT service_type, COUNT(*) as n, SUM(active) as active FROM smm_services WHERE active=1 GROUP BY service_type ORDER BY active DESC').all();
const byPlat = db.prepare('SELECT platform, COUNT(*) as active FROM smm_services WHERE active=1 GROUP BY platform ORDER BY active DESC LIMIT 12').all();
console.log(JSON.stringify({ total, byType, byPlat }, null, 2));
