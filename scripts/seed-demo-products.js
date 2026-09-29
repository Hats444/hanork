#!/usr/bin/env node
'use strict';

/**
 * Cria produtos demo (cursores) na loja legacy (tenant_id NULL) se não existirem.
 * Uso: node scripts/seed-demo-products.js
 */

const path = require('path');
const { connect } = require('../src/config/database-sqlite');

const DEMOS = [
    {
        name: 'Cursor Dragon Premium',
        price: 39.9,
        description:
            '🐉 Cursor animado estilo dragon para seu site ou perfil.\n\n' +
            '✅ Arquivo HTML/JS pronto\n' +
            '⚡ Entrega automática após o pagamento\n' +
            '✅ Fácil de instalar',
        file_url: 'dragon_preview/dragon/index.html',
        category: 'html',
        photo_url: '',
    },
    {
        name: 'Cursor Centopeia',
        price: 24.9,
        description:
            '🐛 Efeito centopeia para páginas e vitrines.\n\n' +
            '✅ Pack completo em HTML/JS\n' +
            '⚡ Entrega imediata no Telegram\n' +
            '✅ Suporte por mensagem',
        file_url: 'centopeia_preview/centopeia/index.html',
        category: 'html',
        photo_url: '',
    },
];

function main() {
    const db = connect();
    const insert = db.prepare(
        `INSERT INTO products (name, price, description, file_url, photo_url, category, stock, active, tenant_id)
         VALUES (?, ?, ?, ?, ?, ?, 999, 1, NULL)`
    );
    let created = 0;
    for (const d of DEMOS) {
        const exists = db.prepare('SELECT id FROM products WHERE name=? AND tenant_id IS NULL').get(d.name);
        if (exists) {
            console.log(`  skip: ${d.name}`);
            continue;
        }
        insert.run(d.name, d.price, d.description, d.file_url, d.photo_url, d.category);
        console.log(`  + ${d.name}`);
        created++;
    }
    console.log(`\nCriados: ${created}\n`);
}

try {
    main();
} catch (e) {
    console.error(e.message);
    process.exit(1);
}
