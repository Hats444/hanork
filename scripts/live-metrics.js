#!/usr/bin/env node
'use strict';

const path = require('path');
const Database = require('better-sqlite3');

const root = path.resolve(__dirname, '..');
const dbPath = path.join(root, 'hanork.db');
const db = new Database(dbPath, { readonly: true });

const users = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
const orders = db.prepare('SELECT COUNT(*) AS c FROM orders').get().c;

const orderCols = db.prepare('PRAGMA table_info(orders)').all().map((c) => c.name);
const userCol = orderCols.includes('user_id')
  ? 'user_id'
  : orderCols.includes('telegram_id')
    ? 'telegram_id'
    : null;
const amountCol = ['total', 'amount', 'price', 'total_amount'].find((c) => orderCols.includes(c));
const statusCol = orderCols.includes('status')
  ? 'status'
  : orderCols.includes('payment_status')
    ? 'payment_status'
    : null;

let payers = 0;
let revenue = 0;

if (userCol && statusCol) {
  const paid = db
    .prepare(
      `SELECT ${userCol} AS uid, ${amountCol || '0'} AS amt, ${statusCol} AS st FROM orders`
    )
    .all();
  const paidStatuses = new Set(['paid', 'delivered', 'completed', 'PAID', 'DELIVERED', 'APPROVED']);
  const paidRows = paid.filter((r) => paidStatuses.has(String(r.st)));
  payers = new Set(paidRows.map((r) => r.uid).filter(Boolean)).size;
  revenue = paidRows.reduce((s, r) => s + (Number(r.amt) || 0), 0);
}

const conversion = users ? Number(((payers / users) * 100).toFixed(1)) : 0;

console.log(
  JSON.stringify(
    {
      ts: new Date().toISOString(),
      users,
      orders,
      payers,
      revenue: Number(revenue) || 0,
      conversionPct: conversion,
    },
    null,
    2
  )
);
