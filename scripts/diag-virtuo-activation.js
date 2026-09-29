'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const VirtuoApiClient = require('../src/modules/virtuo/providers/virtuoApiClient');

async function main() {
    const countries = await VirtuoApiClient.getCountries({ server: 1, limit: 200, page: 1 });
    const list = countries.data?.countries || countries.data || [];
    console.log('sample country keys:', list[0] ? Object.keys(list[0]) : []);
    for (const name of ['argentina', 'ecuador', 'canada']) {
        const m = list.find((c) => String(c.name || c.countryName || '').toLowerCase().includes(name));
        console.log(name, m);
    }

    let page = 1;
    let wa = null;
    while (page <= 5 && !wa) {
        const s = await VirtuoApiClient.getServices({ server: 1, page, limit: 100 });
        wa = (s.data?.services || []).find((x) => String(x.id).toLowerCase() === 'wa');
        page++;
    }
    if (wa) {
        console.log('\n/services wa country sample keys:', wa.countries?.[0] ? Object.keys(wa.countries[0]) : []);
        for (const name of ['Argentina', 'Ecuador', 'Canada']) {
            const m = (wa.countries || []).find((c) => String(c.name || '').includes(name));
            console.log('/services', name, m);
        }
    }

    for (const cid of [38, 39, 102, 105]) {
        const act = await VirtuoApiClient.requestActivation({ service: 'wa', country: cid, server: 1, maxPrice: 10 });
        console.log('country', cid, act.ok ? act.data?.country : act.error);
        if (act.ok && act.data?.id) await VirtuoApiClient.cancelActivation(act.data.id);
    }
}

main().catch(console.error);
