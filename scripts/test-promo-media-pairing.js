#!/usr/bin/env node
'use strict';

/**
 * Valida pareamento texto↔mídia HANORK/SSM e contagens dos temas.
 */
const path = require('path');
const fs = require('fs');

const root = path.join(__dirname, '..');
const hanorkThemes = JSON.parse(
  fs.readFileSync(path.join(root, 'src/data/hanorkPromoThemes.json'), 'utf8')
);
const smmThemes = JSON.parse(
  fs.readFileSync(path.join(root, 'src/data/smmPromoThemes.json'), 'utf8')
);
const { pickHanorkBroadcast } = require('../src/data/hanorkBroadcastVariants');
const { pickSmmBroadcast } = require('../src/data/smmBroadcastVariants');
const { validatePromoPair } = require('../src/utils/promoMediaValidation');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(hanorkThemes.length === 20, `hanork: esperado 20, got ${hanorkThemes.length}`);
assert(smmThemes.length === 20, `smm: esperado 20, got ${smmThemes.length}`);

hanorkThemes.forEach((t, i) => {
  const expected = `hanork_${String(i + 1).padStart(2, '0')}.jpg`;
  assert(t.image_file === expected, `hanork[${i}] image_file ${t.image_file} !== ${expected}`);
  assert(!/^ssm_/i.test(t.image_file), `hanork[${i}] image_file SSM proibido`);
});

smmThemes.forEach((t, i) => {
  const expected = `ssm_${String(i + 1).padStart(2, '0')}.jpg`;
  assert(t.image_file === expected, `smm[${i}] image_file ${t.image_file} !== ${expected}`);
  assert(!/^hanork/i.test(t.image_file), `smm[${i}] image_file HANORK proibido`);
});

const kv = { _m: new Map(), get(k) { return this._m.get(k) ?? null; }, set(k, v) { this._m.set(k, v); } };
const photosDir = path.join(root, 'fotos');

const h = pickHanorkBroadcast(kv, photosDir);
assert(h.variant?.id, 'pickHanorkBroadcast sem variant');
assert(h.photoFile === h.variant.image_file, 'hanork: photoFile deve seguir image_file do tema');

const s = pickSmmBroadcast(kv, photosDir);
assert(s.variant?.id, 'pickSmmBroadcast sem variant');
assert(s.photoFile === s.variant.image_file, 'smm: photoFile deve seguir image_file do tema');

// mistura bloqueada
const badHanork = validatePromoPair('hanork', {
  variant: h.variant,
  photo: 'x',
  photoFile: 'ssm_01.jpg',
  photosDir,
});
assert(!badHanork.ok, 'deveria bloquear hanork+ssm');

const badSmm = validatePromoPair('smm', {
  variant: s.variant,
  photo: 'x',
  photoFile: 'hanork_01.jpg',
  photosDir,
});
assert(!badSmm.ok, 'deveria bloquear smm+hanork');

console.log('OK promo media pairing — 20 hanork + 20 smm themes, validação de mistura ativa');
