'use strict';

const path = require('path');

const adminDir = path.join(__dirname, '../src/telegram/commands/admin');
const files = [
    'shared.js', 'panelHandlers.js', 'broadcastHandlers.js', 'bridgeHandlers.js',
    'groupsHandlers.js', 'crmHandlers.js', 'ordersHandlers.js', 'supportHandlers.js',
    'destinationHelpers.js', 'index.js',
];

let failed = 0;
for (const file of files) {
    try {
        require(path.join(adminDir, file));
        console.log('OK', file);
    } catch (e) {
        failed++;
        console.error('FAIL', file, e.message);
    }
}

process.exit(failed ? 1 : 0);
