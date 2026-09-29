#!/usr/bin/env node
'use strict';

/**
 * Garante better-sqlite3 compilado para o Node atual (hanork + zero-divu).
 * Evita ERR_DLOPEN_FAILED / "Module did not self-register" após troca de Node ou restart.
 */
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..');

const PACKAGES = [
  { label: 'hanork', cwd: REPO },
  { label: 'zero-divu', cwd: path.join(REPO, 'zero-divu') },
];

function npmBin() {
  const nodeBin = process.execPath;
  const bin = path.join(path.dirname(nodeBin), process.platform === 'win32' ? 'npm.cmd' : 'npm');
  return fs.existsSync(bin) ? bin : 'npm';
}

function envWithNodeFirst() {
  const pathKey = process.platform === 'win32' ? 'Path' : 'PATH';
  return {
    ...process.env,
    [pathKey]: `${path.dirname(process.execPath)}${path.delimiter}${process.env[pathKey] || ''}`,
  };
}

function hasModule(cwd) {
  return fs.existsSync(path.join(cwd, 'node_modules', 'better-sqlite3', 'package.json'));
}

function probe(cwd) {
  if (!hasModule(cwd)) return { ok: true, skip: true };
  try {
    const req = createRequire(path.join(cwd, 'package.json'));
    req('better-sqlite3')(':memory:');
    return { ok: true };
  } catch (e) {
    return { ok: false, code: e?.code, message: e?.message || String(e) };
  }
}

function rebuild(cwd, label, fromSource = false) {
  const nodeFile = path.join(cwd, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
  try {
    if (fs.existsSync(nodeFile)) fs.unlinkSync(nodeFile);
  } catch {
    /* ignore */
  }
  const args = ['rebuild', 'better-sqlite3'];
  if (fromSource) args.push('--build-from-source');
  console.warn(`[native] ${label}: rebuild better-sqlite3 (${process.version})…`);
  execFileSync(npmBin(), args, {
    cwd,
    stdio: 'inherit',
    env: envWithNodeFirst(),
  });
}

function ensureOne(pkg) {
  if (!fs.existsSync(pkg.cwd)) return;
  if (!hasModule(pkg.cwd)) return;

  let r = probe(pkg.cwd);
  if (r.ok) {
    if (!r.skip) console.log(`[native] ${pkg.label}: better-sqlite3 OK (${process.version})`);
    return;
  }

  if (r.code !== 'ERR_DLOPEN_FAILED' && !/did not self-register/i.test(String(r.message))) {
    throw new Error(`${pkg.label}: ${r.message}`);
  }

  rebuild(pkg.cwd, pkg.label);
  r = probe(pkg.cwd);
  if (!r.ok) {
    rebuild(pkg.cwd, pkg.label, true);
    r = probe(pkg.cwd);
  }
  if (!r.ok) {
    throw new Error(`${pkg.label}: better-sqlite3 falhou após rebuild — ${r.message}`);
  }
  console.log(`[native] ${pkg.label}: better-sqlite3 OK após rebuild (${process.version})`);
}

function main() {
  for (const pkg of PACKAGES) {
    ensureOne(pkg);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error(`[native] FATAL: ${e.message || e}`);
    process.exit(1);
  }
}

module.exports = { main };
