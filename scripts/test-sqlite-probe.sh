#!/usr/bin/env bash
export PATH="${HOME}/.nvm/versions/node/v20.20.2/bin:${PATH}"
cd /home/vendetta/hanork
node <<'NODE'
const { createRequire } = require('module');
const path = require('path');
const req = createRequire(path.join(process.cwd(), 'package.json'));
try {
  req('better-sqlite3')(':memory:');
  console.log('PROBE_OK createRequire hanork');
} catch (e) {
  console.error('PROBE_FAIL', e.message);
  process.exit(1);
}
NODE
