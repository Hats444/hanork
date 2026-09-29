'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const VirtuoApiClient = require('../src/modules/virtuo/providers/virtuoApiClient');

async function main() {
    const c = await VirtuoApiClient.getCountries({ server: 1, limit: 5, page: 1 });
    console.log(JSON.stringify(c, null, 2).slice(0, 4000));
}

main().catch(console.error);
