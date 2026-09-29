#!/usr/bin/env node
'use strict';

/**
 * Preenche service_family + service_score em smm_services existentes.
 * Uso: node scripts/smm-backfill-families.js [--apply]
 */
const path = require('path');
process.chdir(path.join(__dirname, '..'));
require('../src/config/env');

const { connect, prisma } = require('../src/config/database-sqlite');
const { deriveServiceFamily } = require('../src/modules/smm/services/familyService');
const SmmServiceRepository = require('../src/modules/smm/repositories/smmServiceRepository');

const APPLY = process.argv.includes('--apply');

function main() {
    connect();
    const db = connect();

    const rows = db.prepare('SELECT id, platform, subcategory, name FROM smm_services').all();
    console.log(`\n=== SMM backfill families (${rows.length} rows) ===\n`);
    console.log(`Modo: ${APPLY ? 'APLICAR' : 'dry-run'}\n`);

    const update = db.prepare(`
        UPDATE smm_services SET service_family = ?, updated_at = datetime('now') WHERE id = ?
    `);

    let changed = 0;
    const tx = db.transaction((items) => {
        for (const row of items) {
            const family = deriveServiceFamily(row);
            if (family) {
                if (APPLY) update.run(family, row.id);
                changed++;
            }
        }
    });
    tx(rows);

    let scoreStats = { updated: 0, families: 0 };
    if (APPLY) {
        scoreStats = SmmServiceRepository.refreshFamilyScores();
    }

    const sample = db.prepare(`
        SELECT service_family, COUNT(*) as n, MAX(service_score) as top_score
        FROM smm_services WHERE active = 1 AND service_family IS NOT NULL
        GROUP BY service_family ORDER BY n DESC LIMIT 8
    `).all();

    console.log(`Famílias atribuídas: ${changed}`);
    if (APPLY) {
        console.log(`Scores recalculados: ${scoreStats.updated}`);
        console.log(`Famílias ativas distintas: ${scoreStats.families}`);
    }
    console.log('\nTop famílias (ativos):');
    for (const s of sample) {
        console.log(`  ${s.service_family}: ${s.n} svc · score máx ${s.top_score}`);
    }
    console.log('');
    process.exit(0);
}

main();
