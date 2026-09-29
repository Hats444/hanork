'use strict';

require('dotenv').config();
const path = require('path');
const { filterDivulgacaoProducts } = require('../src/plugins/zero-divu/divulgacaoCatalog');
const { resolveProductPhotoInput } = require('../src/utils/productPhoto');
const { readPhotoBuffer } = require('../src/plugins/zero-divu/promo');
const { connect } = require('../src/config/database-sqlite');

const photosDir = path.join(__dirname, '../fotos');

async function main() {
    const db = connect();
    const rows = db
        .prepare('SELECT id, name, active, stock, photo, photo_url, price FROM products ORDER BY id')
        .all();
    const eligible = filterDivulgacaoProducts(rows.filter((p) => p.active !== 0));
    const withPhoto = [];
    const noPhoto = [];

    for (const p of eligible) {
        let ok = false;
        let reason = '';
        try {
            const photo = resolveProductPhotoInput(p, photosDir);
            if (!photo) reason = 'sem campo photo/photo_url válido';
            else {
                const buf = await readPhotoBuffer(photo, photosDir);
                if (buf?.length) ok = true;
                else reason = 'arquivo/url não leu bytes';
            }
        } catch (e) {
            reason = e.message;
        }
        const item = {
            id: p.id,
            name: p.name,
            price: p.price,
            photo: p.photo || null,
            photo_url: p.photo_url ? 'sim' : null,
            reason: ok ? null : reason,
        };
        if (ok) withPhoto.push(item);
        else noPhoto.push(item);
    }

    console.log(
        JSON.stringify(
            {
                photosDir,
                eligible: eligible.length,
                withPhoto: withPhoto.length,
                noPhoto: noPhoto.length,
                inWaCatalog: withPhoto.map((x) => x.id),
                missingPhoto: noPhoto,
            },
            null,
            2
        )
    );
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
