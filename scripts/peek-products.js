'use strict';
require('dotenv').config();
const { connect } = require('../src/config/database-sqlite');
const db = connect();
for (const id of [15]) {
    console.log(id, db.prepare('SELECT id,name,photo,photo_url FROM products WHERE id=?').get(id));
}
