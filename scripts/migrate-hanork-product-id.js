'use strict';

/**
 * Migra o Hanork PRO de id 15 → 1 (ou HANORK_MIGRATE_FROM / HANORK_MIGRATE_TO).
 * Atualiza FKs, renomeia o produto e desativa os demais.
 */
require('dotenv').config({ quiet: true });

const { connect } = require('../src/config/database-sqlite');

const FROM = Number(process.env.HANORK_MIGRATE_FROM || 15);
const TO = Number(process.env.HANORK_MIGRATE_TO || process.env.HANORK_PRODUCT_ID || 1);

const FK_TABLES = [
  { table: 'order_items', column: 'product_id' },
  { table: 'favorites', column: 'product_id' },
  { table: 'flash_sales', column: 'product_id' },
  { table: 'restock_notify', column: 'product_id' },
  { table: 'active_carts', column: 'product_id' },
];

function tableExists(db, name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

function columnExists(db, table, column) {
  if (!tableExists(db, table)) return false;
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
}

function run() {
  const db = connect();
  const src = db.prepare('SELECT * FROM products WHERE id = ?').get(FROM);
  if (!src) {
    const atTarget = db.prepare('SELECT id, name, active FROM products WHERE id = ?').get(TO);
    if (atTarget) {
      db.prepare('UPDATE products SET active = 1 WHERE id = ?').run(TO);
      db.prepare('UPDATE products SET active = 0 WHERE id != ?').run(TO);
      console.log(`Produto #${TO} já existe: ${atTarget.name}`);
      return;
    }
    throw new Error(`Produto origem #${FROM} não encontrado`);
  }

  if (FROM === TO) {
    db.prepare('UPDATE products SET active = 0 WHERE id != ?').run(TO);
    console.log(`Produto #${TO} mantido — demais desativados.`);
    return;
  }

  const dest = db.prepare('SELECT id FROM products WHERE id = ?').get(TO);

  db.exec('PRAGMA foreign_keys=OFF');
  const tx = db.transaction(() => {
    if (dest) {
      db.prepare('DELETE FROM products WHERE id = ?').run(TO);
    }

    for (const { table, column } of FK_TABLES) {
      if (!columnExists(db, table, column)) continue;
      if (table === 'favorites' || table === 'restock_notify' || table === 'active_carts') {
        db.prepare(
          `DELETE FROM ${table} WHERE ${column} = ? AND user_id IN (SELECT user_id FROM ${table} WHERE ${column} = ?)`
        ).run(FROM, TO);
      }
      db.prepare(`UPDATE ${table} SET ${column} = ? WHERE ${column} = ?`).run(TO, FROM);
    }

    db.prepare('UPDATE products SET id = ? WHERE id = ?').run(TO, FROM);

    const maxId = db.prepare('SELECT MAX(id) AS m FROM products').get()?.m || TO;
    db.prepare("INSERT OR REPLACE INTO sqlite_sequence (name, seq) VALUES ('products', ?)").run(maxId);

    db.prepare('UPDATE products SET active = 0 WHERE id != ?').run(TO);
    db.prepare('UPDATE products SET active = 1 WHERE id = ?').run(TO);
  });

  tx();
  db.exec('PRAGMA foreign_keys=ON');

  const row = db.prepare('SELECT id, name, active, price FROM products WHERE id = ?').get(TO);
  console.log(`Migrado #${FROM} → #${TO}: ${row.name} (R$ ${Number(row.price).toFixed(2)}) — ativo=${row.active}`);
  const active = db.prepare('SELECT id, name FROM products WHERE active = 1 ORDER BY id').all();
  console.log('Ativos:', active.map((r) => `#${r.id} ${r.name}`).join(', ') || 'nenhum');
}

run();
