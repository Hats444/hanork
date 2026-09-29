#!/usr/bin/env node
'use strict';

/**
 * Importa catálogo SMM de all-services.json (ou API se key configurada).
 * Uso: node scripts/smm-import-catalog.js [--source=json|api|auto]
 */
const path = require('path');
process.chdir(path.join(__dirname, '..'));
require('../src/config/env');

const { connect } = require('../src/config/database-sqlite');
const { syncCatalog } = require('../src/modules/smm/services/syncService');

async function main() {
    const arg = process.argv.find((a) => a.startsWith('--source='));
    const source = arg ? arg.split('=')[1] : 'auto';

    connect();
    console.log('\n=== SMM Import Catalog ===\n');
    console.log('source:', source);

    const result = await syncCatalog({ source, syncType: 'manual' });
    console.log('\nResultado:', JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
