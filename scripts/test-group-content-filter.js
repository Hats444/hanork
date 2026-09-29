#!/usr/bin/env node
'use strict';

const {
  analyzeGroupContent,
  validateGroupJoin,
  shouldBlockGroupJoin,
  normalizeBlob,
} = require('../zero-divu/src/services/groupContentFilter');

const cases = [
  ['🍒💕', true],
  ['😈 PEITUDINHAS 👙', true],
  ['GRUPO DE DIVULGAÇÃO 08', false],
  ['DIVULGUE ACHADINHOS ORIGINAL', false],
  ['VIP +18 pack exclusivo', true],
  ['Consultas work promo', false],
  ['تعـالو هـنا نـار 🤤', true],
  ['p.e.i.t.u.d.a.s vip', true],
  ['Grupo Hot Chat Premium', true],
  ['@pack18vip', true, { username: 'pack18vip' }],
  ['Canal normal de ofertas', false],
  ['1 8 + conteudo', true],
  ['Privacy com modelos', true],
  ['Grupo de networking dev', false],
  ['🔞🍑🥵', true],
  ['only fans brasil', true],
  ['DIVULGAÇÃO GERAL BR', false],
];

let fail = 0;
for (const row of cases) {
  const [title, expectBlock, extra = {}] = row;
  const r = analyzeGroupContent({ title, ...extra });
  const ok = r.blocked === expectBlock;
  if (!ok) {
    fail++;
    console.error('FAIL', title, r);
  } else {
    console.log('OK', title.slice(0, 40), r.blocked ? r.reason : 'allow');
  }
}

// WA + TG mesma API
const wa = validateGroupJoin({ title: 'PUTARIA VIP', channel: 'wa' });
const tg = validateGroupJoin({ title: 'PUTARIA VIP', channel: 'tg' });
if (wa.allowed || tg.allowed || wa.reason !== tg.reason) {
  fail++;
  console.error('FAIL unified WA/TG', wa, tg);
} else {
  console.log('OK unified WA/TG same result');
}

const blob = normalizeBlob(['p.e.i.t.u.d.a']);
if (!/peituda/.test(blob)) {
  fail++;
  console.error('FAIL deobfuscate', blob);
} else {
  console.log('OK deobfuscate spaced letters');
}

if (!shouldBlockGroupJoin({ username: 'novinh18hot' })) {
  fail++;
  console.error('FAIL username block');
} else {
  console.log('OK username block');
}

console.log(fail ? `\n${fail} failure(s)` : '\nAll group content filter tests passed');
process.exit(fail ? 1 : 0);
