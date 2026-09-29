#!/usr/bin/env node
'use strict';

/**
 * Valida critérios de soak dual WA (Fases 1–2).
 * Uso (WSL): node scripts/validate-dual-wa-soak.js
 * Opcional: SINCE="2026-06-23T23:30:00" node scripts/validate-dual-wa-soak.js
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });

const HANORK = process.env.HANORK_ROOT || ROOT;
const TERMINAL_LOG =
  process.env.HANORK_TERMINAL_LOG ||
  path.join(process.env.HOME || '/home/vendetta', '.hanork', 'terminal.log');
const IPC_A = path.join(HANORK, 'shared/zero-ipc');
const IPC_B = path.join(HANORK, 'shared/zero-ipc-b');
const SINCE = process.env.SINCE ? new Date(process.env.SINCE) : null;

const checks = [];
let failed = 0;

function ok(name, detail = '') {
  checks.push({ ok: true, name, detail });
}

function warn(name, detail = '') {
  checks.push({ ok: true, name, detail: `⚠ ${detail}` });
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
      maxBuffer: 48 * 1024 * 1024,
    });
  } catch (e) {
    return String(e.stdout || '');
  }
}

function catalogTextoCount(filePath) {
  if (!fs.existsSync(filePath)) return { bytes: 0, texto: 0 };
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const vars = raw.variacoes || raw.variations || [];
  const texto = vars.filter((v) => String(v.texto || '').trim().length > 0).length;
  return { bytes: fs.statSync(filePath).size, texto };
}

function checkEnv() {
  const dual = String(process.env.WA_DUAL_ENABLED || '').trim();
  if (dual === '1' || dual.toLowerCase() === 'true') ok('WA_DUAL_ENABLED', dual);
  else fail('WA_DUAL_ENABLED', `esperado 1, got "${dual}"`);
}

function checkCatalogParity() {
  const aPath = path.join(IPC_A, 'hanork_auto_catalog.json');
  const bPath = path.join(IPC_B, 'hanork_auto_catalog.json');
  const a = catalogTextoCount(aPath);
  const b = catalogTextoCount(bPath);
  if (a.bytes > 0 && a.bytes === b.bytes && a.texto === b.texto && a.texto > 0) {
    ok('Catálogo Hanork espelhado', `${a.bytes} B · ${a.texto} texto(s) em ambos IPC`);
  } else {
    fail('Catálogo Hanork espelhado', `wa_a ${a.bytes}B/${a.texto}t · wa_b ${b.bytes}B/${b.texto}t`);
  }
}

function checkPatches() {
  for (const [label, dir] of [
    ['wa_a', IPC_A],
    ['wa_b', IPC_B],
  ]) {
    const p = path.join(dir, 'config.patch.json');
    if (!fs.existsSync(p)) {
      fail(`config.patch ${label}`, 'ausente');
      continue;
    }
    const patch = JSON.parse(fs.readFileSync(p, 'utf8'));
    const join = Number(patch.MAX_JOIN_PER_HOUR);
    const groups = Number(patch.MAX_GROUPS);
    if (join === 7 && groups === 25) ok(`config.patch ${label}`, `join ${join}/h · cap ${groups}`);
    else fail(`config.patch ${label}`, `join=${join} cap=${groups}`);
  }
}

function checkLogIncidents(text) {
  const slice = SINCE ? text.split('\n').filter((l) => {
    const m = l.match(/\[(\d{2}:\d{2}:\d{2})\]/);
    if (!m) return true;
    return true;
  }).join('\n') : text;

  const conflict440 =
    (slice.match(/conflict.*440|440.*conflict|logged out.*another|session.*replaced|Stream Errored.*conflict/gi) || [])
      .length;
  const noCatalogLines = slice.split('\n').filter((l) => l.includes('no_catalog'));
  const noCatalog = noCatalogLines.length;
  const noCatalogRecent = noCatalogLines.filter((l) => {
    const m = l.match(/\[(\d{2}):(\d{2}):(\d{2})\]/);
    if (!m) return false;
    const total = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    return total >= 23 * 60 + 31;
  }).length;

  if (conflict440 === 0) ok('Sem conflito 440', SINCE ? `desde ${SINCE.toISOString()}` : 'no log inteiro');
  else fail('Sem conflito 440', `${conflict440} ocorrência(s)`);

  if (noCatalog === 0) ok('Sem no_catalog', 'nenhum no período analisado');
  else if (noCatalogRecent === 0) ok('no_catalog', `${noCatalog} histórico(s) — nenhum pós-fix 23:31`);
  else warn('no_catalog', `${noCatalogRecent} após fix (de ${noCatalog} total)`);
}

function checkWorkers(text) {
  const wa1 = text.includes('module":"WA1"') || text.includes('sessionId":"wa_a"');
  const wa2 = text.includes('module":"WA2"') || text.includes('sessionId":"wa_b"');
  if (wa1 && wa2) ok('Workers dual nos logs', 'WA1 + WA2 presentes');
  else fail('Workers dual nos logs', `wa_a=${wa1} wa_b=${wa2}`);
}

function checkCampaignRouting(text) {
  const routed = /Campanha.*sessionId|"sessionId":"wa_[ab]".*campaign|campaign-bcast-(wa_a|wa_b)/i.test(text);
  if (routed) ok('Roteamento campanha (Fase 2)', 'sessionId em log de campanha');
  else warn('Roteamento campanha (Fase 2)', 'aguardar próximo slot 0/6/12/18 para confirmar');
}

function main() {
  checkEnv();
  checkCatalogParity();
  checkPatches();

  if (!fs.existsSync(TERMINAL_LOG)) {
    fail('terminal.log', TERMINAL_LOG);
  } else {
    const text = readLogText(TERMINAL_LOG);
    checkWorkers(text);
    checkLogIncidents(text);
    checkCampaignRouting(text);
  }

  console.log('\n=== validate-dual-wa-soak ===\n');
  for (const c of checks) {
    const icon = c.ok ? (c.detail.startsWith('⚠') ? '~' : '✓') : '✗';
    console.log(`${icon} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  }
  console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} (${checks.length} checks, ${failed} failed)\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
