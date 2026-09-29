'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const VirtuoApiClient = require('../src/modules/virtuo/providers/virtuoApiClient');
const { connect } = require('../src/config/database-sqlite');

async function main() {
    const db = connect();
    for (const name of ['Argentina', 'Ecuador']) {
        const row = db.prepare("SELECT * FROM virtuo_services WHERE service_code='wa' AND country_name LIKE ?").get(`%${name}%`);
        console.log('\nDB', name, row);
    }

    const countries = await VirtuoApiClient.getCountries({ server: 1, limit: 200 });
    console.log('\n/countries ok:', countries.ok, 'count:', countries.data?.countries?.length || countries.data?.length);
    if (countries.ok) {
        const list = countries.data?.countries || countries.data || [];
        for (const name of ['Argentina', 'Ecuador']) {
            const m = list.filter((c) => new RegExp(name, 'i').test(String(c.name || c.countryName || '')));
            console.log('/countries', name, JSON.stringify(m, null, 2));
        }
    }

    const prices = await VirtuoApiClient.getPrices('wa', undefined, 1);
    if (prices.ok) {
        for (const name of ['Argentina', 'Ecuador']) {
            const m = (prices.data?.prices || []).filter((p) => new RegExp(name, 'i').test(String(p.countryName || p.name || '')));
            console.log('/prices wa', name, JSON.stringify(m, null, 2));
        }
    }

    const services = await VirtuoApiClient.getServices({ server: 1, page: 1, limit: 100 });
    if (services.ok) {
        const wa = (services.data?.services || []).find((s) => String(s.id).toLowerCase() === 'wa');
        if (wa) {
            for (const name of ['Argentina', 'Ecuador']) {
                const m = (wa.countries || []).filter((c) => new RegExp(name, 'i').test(String(c.name || c.countryName || '')));
                console.log('/services wa', name, JSON.stringify(m, null, 2));
            }
        }
    }

    const recent = db.prepare(`
        SELECT vo.*, vs.country_id as svc_country_id, vs.country_name as svc_country_name
        FROM virtuo_orders vo
        LEFT JOIN virtuo_services vs ON vs.id = vo.virtuo_service_id
        ORDER BY vo.id DESC LIMIT 5
    `).all();
    console.log('\nRecent orders:', JSON.stringify(recent, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
