#!/usr/bin/env node
'use strict';

const path = require('path');
const os = require('os');
const Database = require('better-sqlite3');

const dbPath =
    process.env.HANORK_DB_PATH ||
    path.join(os.homedir(), '.hanork', 'hanork.db');

const db = new Database(dbPath, { readonly: true });

const users = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
const orders = db.prepare('SELECT COUNT(*) AS c FROM orders').get().c;

const statusRows = db.prepare('SELECT status, COUNT(*) AS c FROM orders GROUP BY status').all();
const waiting = statusRows.find((r) => r.status === 'WAITING_PAYMENT')?.c || 0;

const paidRows = db
    .prepare(
        `SELECT user_id, total FROM orders WHERE status IN ('PAID','DELIVERED')`
    )
    .all();
const payers = new Set(paidRows.map((r) => r.user_id).filter(Boolean)).size;
const revenue = paidRows.reduce((s, r) => s + (Number(r.total) || 0), 0);

let smmActive = 0;
try {
    smmActive = db.prepare('SELECT COUNT(*) AS c FROM smm_services WHERE active = 1').get().c;
} catch {
    /* optional */
}

let walletUsers = 0;
let walletTotal = 0;
try {
    walletUsers = db.prepare('SELECT COUNT(*) AS c FROM user_wallet WHERE balance > 0').get().c;
    walletTotal = Number(db.prepare('SELECT COALESCE(SUM(balance),0) AS s FROM user_wallet').get().s) || 0;
} catch {
    /* migration pending */
}

const conversion = users ? Number(((payers / users) * 100).toFixed(1)) : 0;

console.log(
    JSON.stringify(
        {
            dbPath,
            ts: new Date().toISOString(),
            users,
            orders,
            payers,
            revenue: Math.round(revenue * 100) / 100,
            conversionPct: conversion,
            waitingPayment: waiting,
            orderStatuses: statusRows,
            smmActive,
            walletUsers,
            walletTotal: Math.round(walletTotal * 100) / 100,
        },
        null,
        2
    )
);
