'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dual-bidir-'));
const ipcB = path.join(tmp, 'ipc-b');
fs.mkdirSync(ipcB, { recursive: true });
fs.writeFileSync(
  path.join(ipcB, 'state.json'),
  JSON.stringify({ connected: true, activeGroups: 2, maxGroupsEffective: 25, joinsThisHour: 0, maxJoinsEffective: 2 })
);

process.env.WA_SESSION_ID = 'wa_a';
process.env.WA_DUAL_JOIN_BIDIRECTIONAL = '1';
process.env.WA_DUAL_IPC_DIR_PEER = ipcB;
process.env.WA_DUAL_PEER_SESSION = 'wa_b';
process.env.WA_DUAL_PEER_DISPLAY = 'WA 2';
process.env.ZERO_MAX_GROUPS = '25';
process.env.ZERO_IPC_TOKEN = 'test';

// Mock heavy deps for getLocalJoinStats
const groupValidatorPath = require.resolve('../zero-divu/src/services/groupValidator');
require.cache[groupValidatorPath] = {
  exports: { countActive: () => 26, loadActiveGroups: () => ({}) },
};
const limitsPath = require.resolve('../zero-divu/src/services/operationalLimits');
require.cache[limitsPath] = { exports: { getMaxGroups: () => 25 } };
const antiBanPath = require.resolve('../zero-divu/src/services/antiBan');
require.cache[antiBanPath] = { exports: { canJoinNow: () => true } };

const dualJoinRouter = require('../zero-divu/src/services/dualJoinRouter');

assert.strictEqual(dualJoinRouter.pickJoinTarget(), 'wa_b');

process.env.WA_SESSION_ID = 'wa_b';
process.env.WA_DUAL_IPC_DIR_PEER = path.join(tmp, 'ipc-a');
fs.mkdirSync(process.env.WA_DUAL_IPC_DIR_PEER, { recursive: true });
fs.writeFileSync(
  path.join(process.env.WA_DUAL_IPC_DIR_PEER, 'state.json'),
  JSON.stringify({ connected: true, activeGroups: 26, maxGroupsEffective: 25 })
);
process.env.WA_DUAL_PEER_SESSION = 'wa_a';
require.cache[groupValidatorPath] = {
  exports: { countActive: () => 5, loadActiveGroups: () => ({}) },
};

delete require.cache[require.resolve('../zero-divu/src/services/dualJoinRouter')];
const dualJoinRouterB = require('../zero-divu/src/services/dualJoinRouter');
assert.strictEqual(dualJoinRouterB.pickJoinTarget(), 'local');

console.log('test-dual-join-bidirectional: PASS');
