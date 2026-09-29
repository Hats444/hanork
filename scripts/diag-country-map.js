'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const VirtuoApiClient = require('../src/modules/virtuo/providers/virtuoApiClient');

async function main() {
    const prices = await VirtuoApiClient.getPrices('wa', undefined, 1);
    for (const cid of [38, 39, 102, 105]) {
        const row = (prices.data?.prices || []).find((p) => Number(p.countryId ?? p.id) === cid);
        console.log('API countryId', cid, row ? row.countryName : 'NOT IN PRICES');
    }
}

main().catch(console.error);
