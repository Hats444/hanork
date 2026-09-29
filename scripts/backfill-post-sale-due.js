#!/usr/bin/env node
'use strict';

const path = require('path');
const Database = require('better-sqlite3');

process.chdir(path.join(__dirname, '..'));
require('../src/config/env');

const { resolveHanorkDbPath } = require('../src/utils/sqliteJournal');
const { computePostSaleDue } = require('../src/utils/postSaleSchedule');

const APPLY = process.argv.includes('--apply');
const RECENT_DAYS = Math.max(1, parseInt(process.env.POST_SALE_BACKFILL_DAYS || '14', 10));
const dbPath = resolveHanorkDbPath(
  process.env.HANORK_DB_PATH || path.join(process.env.HOME || '', '.hanork', 'hanork.db')
);
const db = new Database(dbPath);

const rows = db
  .prepare(
    `SELECT id, delivered_at, updated_at, post_sale_due, post_sale_sent
     FROM orders WHERE status = 'DELIVERED' AND post_sale_due IS NULL`
  )
  .all();

let scheduleRecent = 0;
let skipOld = 0;
const updates = [];

function parseSqliteDate(s) {
  if (!s) return null;
  const t = String(s).trim().replace(' ', 'T');
  const d = new Date(/Z|[+-]\d{2}/.test(t) ? t : `${t}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

for (const row of rows) {
  const base = row.delivered_at || row.updated_at;
  const baseDate = parseSqliteDate(base);
  if (!baseDate) {
    skipOld++;
    continue;
  }
  const ageDays = (Date.now() - baseDate.getTime()) / 86400000;
  if (ageDays > RECENT_DAYS) {
    updates.push({ id: row.id, action: 'mark_sent', reason: 'legacy' });
    skipOld++;
    continue;
  }
  const due = computePostSaleDue(baseDate);
  updates.push({ id: row.id, action: 'schedule', post_sale_due: due });
  scheduleRecent++;
}

console.log('\n=== Backfill pós-venda D+1 ===\n');
console.log(`DB: ${dbPath}`);
console.log(`Janela recente: ${RECENT_DAYS} dias`);
console.log(`DELIVERED sem post_sale_due: ${rows.length}`);
console.log(`Agendar follow-up: ${scheduleRecent}`);
console.log(`Marcar enviado (legado): ${skipOld}`);
console.log(`Modo: ${APPLY ? 'APLICAR' : 'dry-run (--apply)'}\n`);

if (APPLY && updates.length) {
  const sched = db.prepare(
    'UPDATE orders SET post_sale_due = ?, post_sale_sent = 0, updated_at = datetime(\'now\') WHERE id = ?'
  );
  const skip = db.prepare(
    'UPDATE orders SET post_sale_sent = 1, updated_at = datetime(\'now\') WHERE id = ?'
  );
  const tx = db.transaction(() => {
    for (const u of updates) {
      if (u.action === 'schedule') sched.run(u.post_sale_due, u.id);
      else skip.run(u.id);
    }
  });
  tx();
  console.log('Aplicado.\n');
}
