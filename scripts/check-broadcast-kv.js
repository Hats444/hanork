#!/usr/bin/env node
'use strict';
const path = require('path');
process.chdir(path.join(__dirname, '..'));
require('../src/config/env');
const { connect } = require('../src/config/database-sqlite');
const db = connect();
for (const r of db.prepare("SELECT key, value FROM kv_store WHERE key LIKE 'auto_broadcast%'").all()) {
    console.log(r.key, String(r.value || '').slice(0, 120));
}
