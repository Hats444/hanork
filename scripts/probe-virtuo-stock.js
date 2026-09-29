'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const VirtuoApiClient = require('../src/modules/virtuo/providers/virtuoApiClient');
const { connect } = require('../src/config/database-sqlite');

async function main() {
    const db = connect();
    const arg = db.prepare(
        "SELECT id, service_code, country_id, country_name, available, active FROM virtuo_services WHERE service_code='wa' AND country_name LIKE '%Argent%' LIMIT 5"
    ).all();
    console.log('DB Argentina WA:', JSON.stringify(arg, null, 2));

    const waTop = db.prepare(
        "SELECT id, country_id, country_name, available, active FROM virtuo_services WHERE service_code='wa' AND active=1 ORDER BY available DESC LIMIT 10"
    ).all();
    console.log('\nDB WA top available:', JSON.stringify(waTop, null, 2));

    const prices = await VirtuoApiClient.getPrices('wa', undefined, 1);
    console.log('\n/prices wa (all countries) ok:', prices.ok, 'count:', prices.data?.prices?.length);
    if (prices.ok) {
        const ar = (prices.data?.prices || []).filter((p) =>
            /argent/i.test(String(p.countryName || p.name || ''))
        );
        console.log('Argentina from /prices:', JSON.stringify(ar, null, 2));
        const withStock = (prices.data?.prices || []).filter((p) => Number(p.available) > 0);
        console.log('Countries with available>0:', withStock.length);
        console.log('Sample zero stock:', (prices.data?.prices || []).filter((p) => Number(p.available) <= 0).slice(0, 5).map((p) => ({
            id: p.countryId ?? p.id,
            name: p.countryName || p.name,
            available: p.available,
        })));
    } else {
        console.log('prices error:', prices.error);
    }

    if (arg[0]) {
        const cid = arg[0].country_id;
        for (const c of [cid, String(cid), undefined]) {
            const live = await VirtuoApiClient.getPrices('wa', c, 1);
            console.log(`\n/prices wa country=${c}: ok=${live.ok}`, live.ok ? live.data?.prices?.[0] : live.error);
        }
    }

    // Test activation (dry — só erro, sem cobrar se NO_NUMBERS)
    const act = await VirtuoApiClient.requestActivation({
        service: 'wa',
        country: 39,
        server: 1,
        maxPrice: 5.67,
    });
    console.log('\nactivation wa/Argentina:', JSON.stringify(act, null, 2));

    const services = await VirtuoApiClient.getServices({ search: 'whatsapp', server: 1, page: 1, limit: 5 });
    if (services.ok) {
        const wa = (services.data?.services || []).find((s) => String(s.id).toLowerCase() === 'wa');
        if (wa) {
            const arSvc = (wa.countries || []).filter((c) => /argent/i.test(String(c.countryName || c.name || '')));
            console.log('\n/services wa Argentina:', JSON.stringify(arSvc, null, 2));
        }
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
