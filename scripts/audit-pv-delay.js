#!/usr/bin/env node
'use strict';

/**
 * Audita intervalos reais entre envios PV nos logs.
 * Uso: node scripts/audit-pv-delay.js [caminho-log]
 */
const fs = require('fs');
const path = require('path');

const logPath =
  process.argv[2] ||
  path.join(process.env.HOME || '', '.hanork', 'terminal.log');
const alt = path.join(__dirname, '..', 'logs', 'bot.log');
const file = fs.existsSync(logPath) ? logPath : alt;

if (!fs.existsSync(file)) {
  console.error('Log não encontrado:', file);
  process.exit(1);
}

const raw = fs.readFileSync(file, 'utf8');
const patterns = [
  /\[AutoBroadcast\].*PV/i,
  /broadcast:pv/i,
  /campaign_orchestrator.*pv/i,
  /pv.*enviado/i,
  /PV.*sent/i,
  /divulgação.*PV/i,
];

const tsRe = /\[(\d{2}:\d{2}:\d{2})\]/;
const lines = raw.split('\n');
const hits = [];

for (const line of lines) {
  if (!patterns.some((p) => p.test(line))) continue;
  const m = line.match(tsRe);
  if (!m) continue;
  hits.push({ time: m[1], line: line.slice(0, 200) });
}

const gaps = [];
for (let i = 1; i < hits.length; i++) {
  const a = hits[i - 1].time.split(':').map(Number);
  const b = hits[i].time.split(':').map(Number);
  const secA = a[0] * 3600 + a[1] * 60 + a[2];
  const secB = b[0] * 3600 + b[1] * 60 + b[2];
  let gap = secB - secA;
  if (gap < 0) gap += 86400;
  gaps.push(gap);
}

const boot60000 = (raw.match(/userDelayMs":60000/g) || []).length;
const boot80 = (raw.match(/userDelayMs":80/g) || []).length;

console.log(JSON.stringify({
  ts: new Date().toISOString(),
  logFile: file,
  pvLogLines: hits.length,
  bootUserDelay60000: boot60000,
  bootUserDelay80: boot80,
  gapsSec: gaps.slice(-10),
  medianGapSec: gaps.length
    ? gaps.slice().sort((x, y) => x - y)[Math.floor(gaps.length / 2)]
    : null,
  sampleLast3: hits.slice(-3),
  note: hits.length < 2
    ? 'Nenhum ciclo PV registrado no log ainda — aguardar slot 08h/18h'
    : undefined,
}, null, 2));
