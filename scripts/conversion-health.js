#!/usr/bin/env node
'use strict';

/**
 * Saúde dos fluxos de conversão (Semana 3) + config PV.
 * Uso: node scripts/conversion-health.js
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

process.chdir(path.join(__dirname, '..'));
require('../src/config/env');

const { resolveHanorkDbPath } = require('../src/utils/sqliteJournal');
const broadcastConfig = require('../src/config/broadcastConfig');

const dbPath = resolveHanorkDbPath(
  process.env.HANORK_DB_PATH || path.join(process.env.HOME || '', '.hanork', 'hanork.db')
);
const db = new Database(dbPath, { readonly: true });

const postSaleScheduled = db
  .prepare('SELECT COUNT(*) AS c FROM orders WHERE post_sale_due IS NOT NULL')
  .get().c;
const postSalePending = db
  .prepare(
    "SELECT COUNT(*) AS c FROM orders WHERE post_sale_due IS NOT NULL AND COALESCE(post_sale_sent, 0) = 0"
  )
  .get().c;
const postSaleDueNow = db
  .prepare(
    "SELECT COUNT(*) AS c FROM orders WHERE post_sale_due IS NOT NULL AND COALESCE(post_sale_sent, 0) = 0 AND datetime(post_sale_due) <= datetime('now')"
  )
  .get().c;
const deliveredNoDue = db
  .prepare(
    "SELECT COUNT(*) AS c FROM orders WHERE status = 'DELIVERED' AND post_sale_due IS NULL"
  )
  .get().c;

const waitingPayment = db
  .prepare("SELECT COUNT(*) AS c FROM orders WHERE status = 'WAITING_PAYMENT'")
  .get().c;
const abandonedCartMin = Number(process.env.ABANDONED_CART_MINUTES) || 60;

const pvDelay = broadcastConfig.userDelayMs ?? broadcastConfig.resolvePvMinGapMs?.() ?? null;
const pvMode = process.env.AUTO_BROADCAST_MODE || broadcastConfig.mode || '?';

let lastPvBoot = null;
const logPaths = [
  path.join(process.cwd(), 'logs', 'bot.log'),
  path.join(process.env.HOME || '', '.hanork', 'terminal.log'),
];
for (const lp of logPaths) {
  try {
    if (!fs.existsSync(lp)) continue;
    const tail = fs.readFileSync(lp, 'utf8').slice(-800000);
    const matches = [...tail.matchAll(/userDelayMs":(\d+)/g)];
    if (matches.length) lastPvBoot = Number(matches[matches.length - 1][1]);
  } catch {
    /* ignore */
  }
}

const smmActive = db.prepare('SELECT COUNT(*) AS c FROM smm_services WHERE active = 1').get().c;

const report = {
  ts: new Date().toISOString(),
  postSale: {
    scheduled: postSaleScheduled,
    pending: postSalePending,
    dueNow: postSaleDueNow,
    deliveredLegacyNoDue: deliveredNoDue,
  },
  abandonedCart: {
    minutes: abandonedCartMin,
    waitingPaymentOrders: waitingPayment,
  },
  pvBroadcast: {
    userDelayMsEnv: Number(process.env.AUTO_BROADCAST_USER_DELAY_MS) || null,
    userDelayMsConfig: pvDelay,
    lastBootUserDelayMs: lastPvBoot,
    mode: pvMode,
    pvQueue: process.env.BROADCAST_PV_USE_QUEUE === '1',
    ok: lastPvBoot === 60000 || pvDelay === 60000,
  },
  smm: { activeServices: smmActive },
};

console.log(JSON.stringify(report, null, 2));

const issues = [];
if (!report.pvBroadcast.ok) issues.push('PV delay != 60000ms');

if (issues.length) {
  console.error('\nAtenção:', issues.join(' · '));
  process.exit(1);
}

if (deliveredNoDue > 0) {
  console.warn(
    `\nNota: ${deliveredNoDue} entregas antigas sem post_sale_due — novas entregas passam a agendar D+1 automaticamente.`
  );
}
