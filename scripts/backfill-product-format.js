#!/usr/bin/env node
'use strict';

/**
 * Atualiza products.category de valores legados (geral, Assinatura, Serviço)
 * para formato de arquivo (zip, txt, pdf, …).
 *
 * Uso: node scripts/backfill-product-format.js
 *      node scripts/backfill-product-format.js --dry-run
 */

const { connect } = require('../src/config/database-sqlite');
const { formatForStorage, LEGACY_CATEGORIES } = require('../src/utils/productFormat');

const dryRun = process.argv.includes('--dry-run');

function main() {
    const db = connect();
    const rows = db.prepare('SELECT id, name, file_url, category, is_subscription FROM products').all();
    const update = db.prepare('UPDATE products SET category=? WHERE id=?');
    let changed = 0;
    let skipped = 0;

    console.log(`\n=== Backfill formato de produtos ${dryRun ? '(dry-run)' : ''} ===\n`);
    console.log(`Total: ${rows.length}\n`);

    const run = db.transaction(() => {
        for (const p of rows) {
            const cat = String(p.category || '').trim().toLowerCase();
            const isLegacy = !cat || LEGACY_CATEGORIES.has(cat);
            if (!isLegacy) {
                skipped++;
                continue;
            }
            const next = formatForStorage(p);
            if (!next || next === cat) {
                skipped++;
                continue;
            }
            console.log(`  #${p.id} ${p.name}: "${p.category || ''}" → "${next}"`);
            if (!dryRun) update.run(next, p.id);
            changed++;
        }
    });

    run();
    console.log(`\nAtualizados: ${changed} | Sem alteração: ${skipped}`);
    if (dryRun) console.log('\nExecute sem --dry-run para aplicar.\n');
    else console.log('\nConcluído.\n');
}

try {
    main();
} catch (e) {
    console.error('Erro:', e.message);
    if (e.message.includes('Win32') || e.message.includes('better_sqlite3')) {
        console.error('\nDica: rode npm rebuild better-sqlite3 na pasta do projeto.\n');
    }
    process.exit(1);
}
