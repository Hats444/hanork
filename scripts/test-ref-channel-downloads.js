#!/usr/bin/env node
'use strict';

const path = require('path');
process.chdir(path.join(__dirname, '..'));
require('../src/config/env');

const refGuard = require('../src/telegram/referenceChannelGuard');
const downloadsGuard = require('../src/telegram/downloadsGuard');
const daily = require('../src/telegram/downloadsDailyLimit');
const groupGuard = require('../src/telegram/groupGuard');
const { connect } = require('../src/config/database-sqlite');

let ok = 0;
let fail = 0;

function assert(cond, msg) {
    if (cond) {
        ok++;
        console.log('  OK', msg);
    } else {
        fail++;
        console.log('  FAIL', msg);
    }
}

connect();

assert(refGuard.isEnabled(), 'ref channel required by default');
assert(refGuard.channelMenuRow()?.[0]?.text === 'Referências', 'channel menu label');
assert(downloadsGuard.getDailyLimit() === 100, 'default daily limit 100');

const pvCtx = { from: { id: 999001 }, chat: { type: 'private', id: 999001 } };
const groupCtx = { from: { id: 999002 }, chat: { type: 'supergroup', id: -1001 } };

assert(downloadsGuard.canUseDownloads(pvCtx), 'downloads allowed in PV');
assert(!downloadsGuard.canUseDownloads(groupCtx), 'downloads blocked in group');
assert(refGuard.isExemptAction({ from: { id: 1 }, message: { text: '/start' } }), 'bare /start exempt');
assert(refGuard.isExemptAction({ from: { id: 1 }, message: { text: '/start ref_abc' } }), 'ref start exempt');
assert(!refGuard.isExemptAction({ from: { id: 1 }, message: { text: '/start downloads' } }), 'deep start gated');
assert(refGuard.isExemptAction({ from: { id: 1 }, callbackQuery: { data: 'menu:home' } }), 'menu:home exempt');
assert(refGuard.isExemptAction({ from: { id: 1 }, callbackQuery: { data: 'ref:verify' } }), 'ref:verify exempt');
assert(!refGuard.isExemptAction({ from: { id: 1 }, callbackQuery: { data: 'catalog:view' } }), 'catalog gated');

const pendingUid = 777001;
refGuard.savePendingAction(pendingUid, { type: 'callback', data: 'downloads:open' });
const loaded = refGuard.capturePendingFromCtx({
    from: { id: 1 },
    callbackQuery: { data: 'catalog:view' },
});
assert(loaded?.type === 'callback' && loaded.data === 'catalog:view', 'capture callback pending');
const mapped = refGuard.capturePendingFromStartPayload('downloads');
assert(mapped?.data === 'downloads:open', 'map start downloads');
connect().prepare('DELETE FROM kv_store WHERE key=?').run(`ref_pending:${pendingUid}`);

const uid = 42424242;
const db = connect();
db.prepare('DELETE FROM kv_store WHERE key LIKE ?').run(`dl_daily:${uid}:%`);
let c = daily.tryConsume(uid, 1, db);
assert(c.ok && c.remaining === 99, 'first consume');
for (let i = 0; i < 99; i++) daily.tryConsume(uid, 1, db);
c = daily.tryConsume(uid, 1, db);
assert(!c.ok && c.reason === 'limit', 'limit at 100');
db.prepare('DELETE FROM kv_store WHERE key LIKE ?').run(`dl_daily:${uid}:%`);

assert(groupGuard.isPrivateChat(pvCtx), 'pv detect');
assert(groupGuard.isGroupChat(groupCtx), 'group detect');

console.log(`\n${ok} ok, ${fail} fail\n`);
process.exit(fail ? 1 : 0);
