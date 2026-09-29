#!/usr/bin/env node
'use strict';

/**
 * Corrige country_id no catálogo virtuo_services usando /v1/prices (fonte oficial).
 * Nunca usa virtuo_services.id como country da API.
 */
require('dotenv').config();
const { connect } = require('../src/config/database-sqlite');
const VirtuoServiceRepository = require('../src/modules/virtuo/repositories/virtuoServiceRepository');
const { resolveForCatalogRow } = require('../src/modules/virtuo/utils/virtuoCountryResolver');

async function main() {
    connect();
    const rows = connect().prepare('SELECT * FROM virtuo_services ORDER BY id ASC').all();
    let fixed = 0;
    let ok = 0;
    let fail = 0;

    for (const row of rows) {
        const r = await resolveForCatalogRow(row);
        if (!r.ok) {
            fail++;
            console.log(`FAIL id=${row.id} ${row.service_code}/${row.country_name}: ${r.error?.code}`);
            continue;
        }
        ok++;
        if (Number(row.country_id) !== r.apiCountryId) {
            VirtuoServiceRepository.patchCountryId(row.id, r.apiCountryId, r.apiCountryName);
            console.log(
                `FIX id=${row.id} ${row.service_code} ${row.country_name}: ${row.country_id} -> ${r.apiCountryId} (${r.apiCountryName})`
            );
            fixed++;
        }
    }

    console.log('\n---');
    console.log(`Total: ${rows.length} | OK: ${ok} | Fixed: ${fixed} | Not in API: ${fail}`);
    console.log(`Sellable: ${VirtuoServiceRepository.countSellable()}`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
