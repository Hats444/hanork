'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pending-sql-'));
const tmpDb = path.join(tmpDir, 'zero-divu.db');

process.env.ZERO_DIVU_STORAGE = 'sql';
process.env.ZERO_DIVU_DB_PATH = tmpDb;

const pending = require('../zero-divu/src/services/pendingInvites');

assert.strictEqual(pending.usingSql(), true);
pending.add('CODE111', { from: '5511', size: 100 }, 'fila');
pending.add('CODE222', { from: '5522' }, 'test');
assert.strictEqual(pending.count(), 2);
assert.strictEqual(pending.has('CODE111'), true);

pending.setInviteSize('CODE222', 80);
const list = pending.listForProcessing();
assert.ok(list.some((x) => x.code === 'CODE222' && x.inviteSize === 80));

pending.remove('CODE111');
assert.strictEqual(pending.count(), 1);

console.log('test-pending-invites-sql: PASS');
