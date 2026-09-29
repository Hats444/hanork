'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDb = path.join(os.tmpdir(), `invite-archive-test-${Date.now()}.db`);
process.env.ZERO_INVITE_LINKS_DB = tmpDb;

const archive = require('../zero-divu/src/services/inviteLinkArchive');

archive.init();
archive.recordDetected('TESTCODE123', { from: '5511999999999@s.whatsapp.net', chat: 'status@broadcast' });
assert.strictEqual(archive.count(), 1);
assert.strictEqual(archive.countJoinable(), 1);

archive.markRouted('TESTCODE123', 'wa_b', { seed: true });
const row = archive.listJoinable(10)[0];
assert.strictEqual(row.code, 'TESTCODE123');
assert.ok(row.url.includes('TESTCODE123'));

archive.markJoined('TESTCODE123', { gid: '120363123@g.us', subject: 'Grupo Teste', size: 120 });
assert.strictEqual(archive.countJoinable(), 0);

try {
  fs.unlinkSync(tmpDb);
} catch {
  /* ignore */
}

console.log('test-invite-link-archive: PASS');
