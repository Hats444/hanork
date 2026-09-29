#!/usr/bin/env node
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const path = args[0] || '/home/vendetta/.hanork/hanork.db';
const doRestore = process.argv.includes('--restore');
const Database = require('better-sqlite3');
const db = new Database(path);

const sub = db.prepare(`
  SELECT s.id, s.user_id, s.telegram_id, s.plan_name, s.status, s.total_paid,
         s.cancelled_at, s.next_payment_date, u.username, u.first_name, u.telegram_id AS user_tg
  FROM subscriptions s
  LEFT JOIN users u ON u.id = s.user_id
  WHERE s.id = 1
`).get();
console.log('sub#1:', JSON.stringify(sub, null, 2));

const buyers = db.prepare(`
  SELECT o.id, o.user_id, o.status, o.total, o.created_at, u.telegram_id, u.username
  FROM orders o
  JOIN users u ON u.id = o.user_id
  WHERE u.telegram_id IN ('8984076006', '8115302402')
  ORDER BY o.id DESC LIMIT 10
`).all();
console.log('recent orders:', JSON.stringify(buyers, null, 2));

if (doRestore && sub && sub.status === 'cancelled') {
  const order = db.prepare(`
    SELECT o.paid_at, o.created_at FROM orders o
    WHERE o.user_id = ? AND o.status IN ('PAID','DELIVERED','DELIVERING')
    ORDER BY COALESCE(o.paid_at, o.created_at) DESC LIMIT 1
  `).get(sub.user_id);
  const daysMatch = String(sub.plan_name || '').match(/(\d+)\s*dia/i);
  const days = daysMatch ? parseInt(daysMatch[1], 10) : 1;
  const paidAt = order?.paid_at || order?.created_at || sub.last_payment_date;
  let nextIso;
  if (paidAt) {
    const expiry = new Date(String(paidAt).replace(' ', 'T') + 'Z');
    expiry.setUTCDate(expiry.getUTCDate() + days);
    nextIso = expiry > new Date() ? expiry.toISOString() : new Date(Date.now() + days * 864e5).toISOString();
  } else {
    nextIso = new Date(Date.now() + days * 864e5).toISOString();
  }
  db.prepare(`
    UPDATE subscriptions
    SET status = 'active', cancelled_at = NULL, next_payment_date = ?
    WHERE id = 1
  `).run(nextIso);
  if (sub.user_id) {
    db.prepare('UPDATE users SET is_premium = 1 WHERE id = ?').run(sub.user_id);
  }
  console.log('RESTORED sub#1 until', nextIso);
  const after = db.prepare('SELECT id,status,next_payment_date FROM subscriptions WHERE id=1').get();
  console.log('after:', JSON.stringify(after));
}
