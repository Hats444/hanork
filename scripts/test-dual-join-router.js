'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dual-join-'));
const secondaryIpc = path.join(tmp, 'ipc-b');
fs.mkdirSync(secondaryIpc, { recursive: true });

process.env.WA_SESSION_ID = 'wa_a';
process.env.WA_DUAL_JOIN_ROUTE = 'wa_b';
process.env.WA_DUAL_IPC_DIR_B = secondaryIpc;
process.env.ZERO_IPC_TOKEN = 'test-token';

const dualJoinRouter = require('../zero-divu/src/services/dualJoinRouter');

(async () => {
  assert.strictEqual(dualJoinRouter.routeEnabled(), true);
  const ok = await dualJoinRouter.forwardInvite('ABC123TEST', { from: 'test' });
  assert.strictEqual(ok, true);

  const lines = fs.readFileSync(path.join(secondaryIpc, 'commands.jsonl'), 'utf8').trim().split('\n');
  assert.strictEqual(lines.length, 1);
  const cmd = JSON.parse(lines[0]);
  assert.strictEqual(cmd.cmd, 'wa.enqueue_invite');
  assert.strictEqual(cmd.args.code, 'ABC123TEST');
  assert.strictEqual(cmd.token, 'test-token');

  console.log('test-dual-join-router: PASS');
})().catch((e) => {
  console.error('test-dual-join-router: FAIL', e);
  process.exit(1);
});
