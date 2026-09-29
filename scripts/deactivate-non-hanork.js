'use strict';
require('dotenv').config({ quiet: true });
const { connect } = require('../src/config/database-sqlite');
const { HANORK_PRODUCT_ID } = require('../src/constants/hanorkProduct');
const db = connect();
db.prepare('UPDATE products SET active = 0 WHERE id != ?').run(HANORK_PRODUCT_ID);
const rows = db.prepare('SELECT id, name, active FROM products ORDER BY id').all();
console.log(rows.filter((r) => r.active).map((r) => `#${r.id} ${r.name}`).join('\n') || 'nenhum ativo');
console.log('Ativos:', rows.filter((r) => r.active).length);
