'use strict';

require('dotenv').config();
const VirtuoApiClient = require('../src/modules/virtuo/providers/virtuoApiClient');
const { resolveApiCountry } = require('../src/modules/virtuo/utils/virtuoCountryResolver');

(async () => {
    for (const server of [1, 2]) {
        const r = await resolveApiCountry({ serviceCode: 'wa', countryName: 'Argentina', server });
        if (r.ok) {
            console.log(`server ${server}: countryId=${r.apiCountryId} available=${r.available} price=${r.price}`);
        } else {
            console.log(`server ${server}: ERROR`, r.error?.code || r.error);
        }
    }
    const bal = await VirtuoApiClient.getBalance();
    console.log('balance:', bal.ok ? bal.data : bal.error);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
