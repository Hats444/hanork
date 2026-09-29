'use strict';
/**
 * Atualiza preços do catálogo com base em referência de mercado (2026).
 * Uso: node scripts/update-product-prices.js [--dry-run]
 *
 * Referências: FluxoPromo R$37–197/mês · PayBots R$35–87/mês · Telebot ~R$29/mês
 * Código-fonte completo (Hanork) = investimento único equivalente a vários meses de SaaS.
 */
require('dotenv').config({ quiet: true });
const { connect } = require('../src/config/database-sqlite');

/** id → { price, note } — catálogo Hanork-only (#1) */
const MARKET_PRICES = {
    1: { price: 500, note: 'Hanork PRO v3 — único produto do catálogo (preço operador)' },
};

const dryRun = process.argv.includes('--dry-run');
const db = connect();
const rows = db.prepare('SELECT id, name, price, active FROM products ORDER BY id').all();
const update = db.prepare('UPDATE products SET price = ? WHERE id = ?');

let changed = 0;
console.log(dryRun ? '=== DRY RUN ===\n' : '=== Atualizando preços ===\n');

for (const row of rows) {
    const plan = MARKET_PRICES[row.id];
    if (!plan) {
        console.log(`skip #${row.id} ${row.name} — sem entrada na tabela`);
        continue;
    }
    const before = Number(row.price);
    const after = Number(plan.price);
    if (Math.abs(before - after) < 0.001) {
        console.log(`=  #${row.id} R$ ${before.toFixed(2)} — ${row.name}`);
        continue;
    }
    console.log(
        `→  #${row.id} R$ ${before.toFixed(2)} → R$ ${after.toFixed(2)} — ${row.name}`
    );
    console.log(`   ${plan.note}`);
    if (!dryRun) {
        update.run(after, row.id);
    }
    changed++;
}

console.log(`\n${changed} produto(s) ${dryRun ? 'seriam atualizados' : 'atualizados'} · ${rows.length} no catálogo`);
