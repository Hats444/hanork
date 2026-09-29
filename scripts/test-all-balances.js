'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const {
    fetchAllSupplierRows,
    buildAllSuppliersHtml,
} = require('../src/services/unifiedSupplierBalance');

(async () => {
    const rows = await fetchAllSupplierRows();
    console.log(JSON.stringify(rows, null, 2));
    console.log('\n--- HTML ---\n');
    console.log(buildAllSuppliersHtml(rows, { showOkHint: true }).replace(/<[^>]+>/g, ''));
})();
