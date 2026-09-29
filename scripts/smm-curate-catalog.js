#!/usr/bin/env node
'use strict';

/**
 * Curadoria do catálogo SMM — mantém os melhores N serviços por plataforma/subcategoria.
 * Uso:
 *   node scripts/smm-curate-catalog.js           # preview (dry-run)
 *   node scripts/smm-curate-catalog.js --apply     # aplica no banco
 *   SMM_CURATE_MAX_PER_SUB=25 node scripts/smm-curate-catalog.js --apply
 */
const path = require('path');
process.chdir(path.join(__dirname, '..'));
require('../src/config/env');

const Database = require('better-sqlite3');

const APPLY = process.argv.includes('--apply');
const MAX_PER_SUB = Math.min(50, Math.max(5, Number(process.env.SMM_CURATE_MAX_PER_SUB) || 20));
const MAX_OUTROS = Math.min(30, Math.max(0, Number(process.env.SMM_CURATE_MAX_OUTROS) || 15));

const JUNK_NAME = /\b(test|demo|xxx|sample|do not|não usar|nao usar)\b/i;
const DEFAULT_TYPE_SQL = "(COALESCE(service_type, 'Default') IN ('Default', 'Package', 'Custom Comments'))";

function dbPath() {
    const raw =
        process.env.HANORK_DB_PATH ||
        path.join(process.env.HOME || '/home/vendetta', '.hanork', 'hanork.db');
    return raw.startsWith('~') ? path.join(process.env.HOME || '/home/vendetta', raw.slice(1)) : raw;
}

function scoreRow(row) {
    const base = Number(row.service_score) || 0;
    if (base > 0) return base;
    let s = 0;
    if (row.refill) s += 2;
    if (row.cancel) s += 1;
    if (Number(row.sale_price) > 0 && Number(row.sale_price) < 500) s += 1;
    return s;
}

function dedupeByFamily(rows) {
    const byFamily = new Map();
    for (const row of rows) {
        const fam = row.service_family || `id_${row.id}`;
        const prev = byFamily.get(fam);
        if (!prev || scoreRow(row) > scoreRow(prev)) {
            byFamily.set(fam, row);
        }
    }
    return [...byFamily.values()];
}

function main() {
    const db = new Database(dbPath());
    const before = db.prepare('SELECT COUNT(*) as c FROM smm_services WHERE active = 1').get().c;
    const total = db.prepare('SELECT COUNT(*) as c FROM smm_services').get().c;

    const nonDefaultBefore = db
        .prepare(`SELECT COUNT(*) as c FROM smm_services WHERE active = 1 AND NOT ${DEFAULT_TYPE_SQL}`)
        .get().c;

    const pairs = db
        .prepare(
            `SELECT DISTINCT platform, subcategory FROM smm_services ORDER BY platform, subcategory`
        )
        .all();

    const keepIds = new Set();

    for (const { platform, subcategory } of pairs) {
        const limit = platform === 'Outros' ? MAX_OUTROS : MAX_PER_SUB;
        const rows = db
            .prepare(
                `SELECT id, name, sale_price, min_quantity, max_quantity, refill, cancel,
                        service_family, service_score
                 FROM smm_services
                 WHERE platform = ? AND subcategory = ?
                   AND ${DEFAULT_TYPE_SQL}
                   AND sale_price > 0
                   AND min_quantity <= max_quantity
                   AND min_quantity >= 1`
            )
            .all(platform, subcategory)
            .filter((r) => !JUNK_NAME.test(r.name || ''));

        const deduped = dedupeByFamily(rows);

        deduped.sort((a, b) => {
            const sa = scoreRow(a);
            const sb = scoreRow(b);
            if (sb !== sa) return sb - sa;
            return Number(a.sale_price) - Number(b.sale_price);
        });

        for (const row of deduped.slice(0, limit)) {
            keepIds.add(row.id);
        }
    }

    const toDeactivate = db
        .prepare('SELECT id FROM smm_services WHERE active = 1')
        .all()
        .filter((r) => !keepIds.has(r.id));

    console.log('\n=== SMM Curadoria de catálogo ===\n');
    console.log(`DB: ${dbPath()}`);
    console.log(`Total importado: ${total}`);
    console.log(`Ativos antes: ${before} (não-Default ativos: ${nonDefaultBefore})`);
    console.log(`Manter ativos: ${keepIds.size} (max ${MAX_PER_SUB}/sub · Outros max ${MAX_OUTROS})`);
    console.log(`Desativar (curadoria): ${toDeactivate.length}`);
    console.log(`Modo: ${APPLY ? 'APLICAR' : 'dry-run (use --apply)'}\n`);

    if (APPLY) {
        const deactivatedTypes = db
            .prepare(
                `UPDATE smm_services SET active = 0, updated_at = datetime('now')
                 WHERE active = 1 AND NOT ${DEFAULT_TYPE_SQL}`
            )
            .run().changes;

        if (toDeactivate.length) {
            const stmt = db.prepare(
                `UPDATE smm_services SET active = 0, updated_at = datetime('now') WHERE id = ?`
            );
            const tx = db.transaction((ids) => {
                for (const { id } of ids) stmt.run(id);
            });
            tx(toDeactivate);
        }

        if (deactivatedTypes) {
            console.log(`Desativados (tipo ≠ Default): ${deactivatedTypes}`);
        }

        try {
            const CacheService = require('../src/modules/smm/services/cacheService');
            CacheService.invalidateAll().then(() => console.log('Cache SMM invalidado.')).catch(() => {});
        } catch (_) { /* ignore */ }
    }

    const after = db.prepare('SELECT COUNT(*) as c FROM smm_services WHERE active = 1').get().c;
    const byPlatform = db
        .prepare(
            `SELECT platform, COUNT(*) as c FROM smm_services WHERE active = 1 GROUP BY platform ORDER BY c DESC`
        )
        .all();

    console.log('Plataformas ativas:');
    for (const p of byPlatform) {
        console.log(`  ${p.platform}: ${p.c}`);
    }
    console.log(`\nAtivos depois: ${after}\n`);
    db.close();
    process.exit(0);
}

main();
