#!/usr/bin/env node
'use strict';

/**
 * Aplica limites de perfil WA no config.patch.json (IPC).
 * Uso: node scripts/patch-wa-profile-limits.js [safe|balanced|aggressive]
 */
const fs = require('fs');
const path = require('path');

const profile = (process.argv[2] || 'balanced').toLowerCase();
const limits = {
  safe: { MAX_GROUPS: 15, OPERATION_PROFILE: 'safe' },
  balanced: { MAX_GROUPS: 30, OPERATION_PROFILE: 'balanced' },
  equilibrado: { MAX_GROUPS: 30, OPERATION_PROFILE: 'balanced' },
  aggressive: { MAX_GROUPS: 50, OPERATION_PROFILE: 'aggressive' },
  agressivo: { MAX_GROUPS: 50, OPERATION_PROFILE: 'aggressive' },
};

const patch = limits[profile] || limits.balanced;
const root = path.join(__dirname, '..');
const dirs = [
  path.join(root, 'shared', 'zero-ipc', 'config.patch.json'),
  path.join(root, 'shared', 'zero-ipc-b', 'config.patch.json'),
];

for (const file of dirs) {
  if (!fs.existsSync(file)) continue;
  const cur = JSON.parse(fs.readFileSync(file, 'utf8'));
  const next = { ...cur, ...patch, maxGroupsPinned: true };
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
  console.log('OK', file, next);
}
