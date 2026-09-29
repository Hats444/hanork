require('dotenv').config();
const { connect } = require('../src/config/database-sqlite');
const { resolveForCatalogRow } = require('../src/modules/virtuo/utils/virtuoCountryResolver');

(async () => {
    connect();
    for (const id of [38, 102, 105]) {
        const row = connect().prepare('SELECT * FROM virtuo_services WHERE id = ?').get(id);
        const r = await resolveForCatalogRow(row);
        console.log(`id=${id} (${row.country_name}) catalog country_id=${row.country_id}`);
        console.log(JSON.stringify(r, null, 2));
        console.log('---');
    }
})();
