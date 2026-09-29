'use strict';

/**
 * Prepara Zero Divu dentro do Hanork: npm install + pasta IPC.
 * Uso: npm run setup:zero
 */
const { spawnSync } = require('child_process');
const path = require('path');

const HANORK_ROOT = path.join(__dirname, '..');
const ZERO_ROOT = path.join(HANORK_ROOT, 'zero-divu');

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status || 1);
}

console.log('Zero Divu →', ZERO_ROOT);
run('npm', ['install'], ZERO_ROOT);
run('node', [path.join(__dirname, 'setup-zero-ipc.js')], HANORK_ROOT);
console.log('OK — rode: node src/bot.js');
