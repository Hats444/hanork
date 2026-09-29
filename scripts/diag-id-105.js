'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { connect } = require('../src/config/database-sqlite');
const db = connect();
console.log('id=105', db.prepare('SELECT * FROM virtuo_services WHERE id=105').get());
console.log('country_id=105', db.prepare("SELECT * FROM virtuo_services WHERE service_code='wa' AND country_id=105").get());
