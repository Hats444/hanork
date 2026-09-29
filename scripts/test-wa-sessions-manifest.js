#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const manifestPath =
  process.env.WA_SESSIONS_MANIFEST ||
  path.join(__dirname, '..', 'config', 'wa-sessions.json');

const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
assert(raw.sessions, 'sessions');
assert(raw.groupAssignment, 'groupAssignment');

const ids = Object.keys(raw.sessions);
assert(ids.includes('wa_a'), 'wa_a');
assert(ids.includes('wa_b'), 'wa_b');

const ipcDirs = new Set();
for (const id of ids) {
  const s = raw.sessions[id];
  assert(s.ipcDir, `${id}.ipcDir`);
  assert(s.role, `${id}.role`);
  assert(!ipcDirs.has(s.ipcDir), `ipcDir duplicado: ${s.ipcDir}`);
  ipcDirs.add(s.ipcDir);
}

assert.strictEqual(raw.sessions.wa_a.ipcDir, 'shared/zero-ipc', 'wa_a usa IPC produção');
assert.strictEqual(raw.sessions.wa_b.statusOnly, true, 'wa_b statusOnly');

assert.strictEqual(raw.groupAssignment.mode, 'manual');
const a = new Set(raw.groupAssignment.wa_a || []);
const b = new Set(raw.groupAssignment.wa_b || []);
const overlap = [...a].filter((g) => b.has(g));
assert.strictEqual(overlap.length, 0, `overlap grupos: ${overlap.join(', ')}`);

const { resolveSession, listSpawnableSessions } = require('../src/plugins/zero-divu/waSessionsManifest');
process.env.WA_DUAL_ENABLED = '0';
assert.deepStrictEqual(listSpawnableSessions(), ['wa_a']);
process.env.WA_DUAL_ENABLED = '1';
assert(listSpawnableSessions().includes('wa_b'));

const waA = resolveSession('wa_a');
const waB = resolveSession('wa_b');
assert(waA.ipcDir.endsWith('shared/zero-ipc') || waA.ipcDir.includes('zero-ipc'));
assert(waB.ipcDir.endsWith('shared/zero-ipc-b') || waB.ipcDir.includes('zero-ipc-b'));
assert.strictEqual(waA.cmdPrefix, 'wa');
assert.strictEqual(waB.cmdPrefix, 'wa2');

console.log('test-wa-sessions-manifest: OK');
