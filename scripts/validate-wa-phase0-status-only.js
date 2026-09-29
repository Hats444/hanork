#!/usr/bin/env node
'use strict';

/**
 * Fase 0 — item 0.3: confirma posts só status (sem espelho chat).
 * Uso (WSL): node scripts/validate-wa-phase0-status-only.js
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });

const MIN_STATUS_ONLY_POSTS = Number(process.env.WA_PHASE0_MIN_POSTS || 10);
const TERMINAL_LOG =
  process.env.HANORK_TERMINAL_LOG ||
  path.join(process.env.HOME || '/home/vendetta', '.hanork', 'terminal.log');

const checks = [];
let failed = 0;

function ok(name, detail = '') {
  checks.push({ ok: true, name, detail });
}

function fail(name, detail = '') {
  checks.push({ ok: false, name, detail });
  failed += 1;
}

function readLogText(filePath) {
  if (!fs.existsSync(filePath)) return '';
  try {
    return execFileSync('grep', ['-a', '.', filePath], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (e) {
    if (e.stdout) return String(e.stdout);
    return fs.readFileSync(filePath, 'utf8');
  }
}

function checkMirrorEnv() {
  const raw = String(process.env.STATUS_MIRROR_TO_CHAT || '').trim().toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'off') {
    ok('STATUS_MIRROR_TO_CHAT', 'desativado (.env)');
    return;
  }
  if (raw === '1' || raw === 'true' || raw === 'on') {
    fail('STATUS_MIRROR_TO_CHAT', 'espelho chat ainda ativo no .env');
    return;
  }
  fail('STATUS_MIRROR_TO_CHAT', `valor ambíguo: "${raw || '(vazio)'}"`);
}

function checkTerminalLog() {
  if (!fs.existsSync(TERMINAL_LOG)) {
    fail('terminal.log', `não encontrado: ${TERMINAL_LOG}`);
    return;
  }

  const text = readLogText(TERMINAL_LOG);
  const lines = text.split('\n').filter(Boolean);

  let statusOk = 0;
  let batchStatusOnly = 0;
  let batchWithMirror = 0;
  let lastEspelhadoIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('✓ Status OK:')) statusOk += 1;

    if (line.includes('Status enviado')) {
      if (line.includes('espelhado')) {
        batchWithMirror += 1;
        lastEspelhadoIdx = i;
      } else {
        batchStatusOnly += 1;
      }
    }
  }

  let mirrorAfterCutoff = 0;
  let statusOnlyAfterCutoff = 0;
  for (let i = lastEspelhadoIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes('Status enviado')) continue;
    if (line.includes('espelhado')) mirrorAfterCutoff += 1;
    else statusOnlyAfterCutoff += 1;
  }

  ok('terminal.log', TERMINAL_LOG);
  ok('Status OK (total)', String(statusOk));
  ok('Lotes status-only (sem espelhado)', String(batchStatusOnly));
  ok('Lotes com espelhado (histórico)', String(batchWithMirror));
  ok('Lotes só status após último espelho', String(statusOnlyAfterCutoff));

  if (mirrorAfterCutoff > 0) {
    fail('Espelho após último lote espelhado', `${mirrorAfterCutoff} linha(s) com "(+ chat espelhado)"`);
  } else {
    ok('Espelho após último lote espelhado', '0 ocorrências');
  }

  const postsForExit = statusOnlyAfterCutoff > 0 ? statusOnlyAfterCutoff : batchStatusOnly;
  if (postsForExit >= MIN_STATUS_ONLY_POSTS) {
    ok(`≥${MIN_STATUS_ONLY_POSTS} posts só status`, String(postsForExit));
  } else {
    fail(`≥${MIN_STATUS_ONLY_POSTS} posts só status`, `encontrados ${postsForExit}`);
  }
}

function checkOpsEvents() {
  const ipcDir =
    process.env.ZERO_DIVU_IPC_DIR || path.join(ROOT, 'shared', 'zero-ipc');
  const opsPath = path.join(ipcDir, 'ops-events.jsonl');
  if (!fs.existsSync(opsPath)) {
    ok('ops-events.jsonl', 'ausente (opcional)');
    return;
  }
  const text = fs.readFileSync(opsPath, 'utf8');
  const chatMirror = text
    .split('\n')
    .filter(Boolean)
    .filter((l) => /chat_mirror|espelho/i.test(l)).length;
  if (chatMirror === 0) ok('ops-events chat_mirror', '0 eventos');
  else fail('ops-events chat_mirror', `${chatMirror} evento(s)`);
}

function main() {
  checkMirrorEnv();
  checkTerminalLog();
  checkOpsEvents();

  console.log('\n=== Fase 0 · validação status-only (0.3) ===\n');
  for (const c of checks) {
    const mark = c.ok ? '✓' : '✗';
    console.log(`${mark} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  }
  console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} (${checks.length - failed}/${checks.length})\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
