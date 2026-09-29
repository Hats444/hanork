#!/usr/bin/env node
'use strict';

/**
 * Testa savePromoPhoto (hanork + smm), slots, nomes de tema e anti-mistura.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
process.chdir(root);

const {
  savePromoPhoto,
  parseSlotFromCaption,
  normalizeSlot,
  themeFileNameForSlot,
  findNextEmptySlot,
  listSlots,
  locatePhoto,
} = require('../src/services/promoPhotoUploadService');
const { validatePromoPair } = require('../src/utils/promoMediaValidation');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const tinyJpeg = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
  0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
]);

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

test('parseSlotFromCaption', () => {
  assert(parseSlotFromCaption('5') === 5, '5');
  assert(parseSlotFromCaption('#12') === 12, '#12');
  assert(parseSlotFromCaption('slot:3') === 3, 'slot:3');
  assert(parseSlotFromCaption('texto promo') === null, 'texto livre');
});

test('normalizeSlot rejeita inválido', () => {
  assert(normalizeSlot('abc', 'hanork') === null, 'abc');
  assert(normalizeSlot(0, 'hanork') === null, '0');
  assert(normalizeSlot(21, 'hanork')?.slot === 21, '21 com warn');
});

test('themeFileNameForSlot pareado', () => {
  assert(themeFileNameForSlot('hanork', 1) === 'hanork_01.jpg', 'h1');
  assert(themeFileNameForSlot('smm', 3) === 'ssm_03.jpg', 's3');
  assert(themeFileNameForSlot('hanork', 3) !== themeFileNameForSlot('smm', 3), 'não mistura nomes');
});

const savedPaths = [];

test('savePromoPhoto hanork slot 1', () => {
  const r = savePromoPhoto('hanork', tinyJpeg, { slot: 1 });
  assert(r.ok, r.error || 'save hanork');
  assert(r.fileName === 'hanork_01.jpg', `nome ${r.fileName}`);
  assert(r.paths.length >= 3, 'pastas hanork');
  savedPaths.push(...r.paths);
  assert(locatePhoto('hanork', 'hanork_01.jpg'), 'localizado hanork');
});

test('savePromoPhoto smm slot 2', () => {
  const r = savePromoPhoto('smm', tinyJpeg, { slot: 2 });
  assert(r.ok, r.error || 'save smm');
  assert(r.fileName === 'ssm_02.jpg', `nome ${r.fileName}`);
  savedPaths.push(...r.paths);
  assert(locatePhoto('smm', 'ssm_02.jpg'), 'localizado smm');
  assert(!locatePhoto('hanork', 'ssm_02.jpg'), 'ssm não em hanork');
});

test('pareamento pós-upload', () => {
  const photosDir = path.join(root, 'fotos');
  assert(locatePhoto('hanork', 'hanork_01.jpg'), 'hanork_01 no disco');
  assert(locatePhoto('smm', 'ssm_02.jpg'), 'ssm_02 no disco');
  assert(
    validatePromoPair('hanork', {
      variant: { id: 't', image_file: 'hanork_01.jpg' },
      photo: 'x',
      photoFile: 'ssm_02.jpg',
      photosDir,
    }).ok === false,
    'bloqueia mistura hanork+ssm'
  );
});

test('findNextEmptySlot após slot 1 preenchido', () => {
  const next = findNextEmptySlot('hanork');
  assert(next >= 2, `próximo hanork >= 2, got ${next}`);
});

async function main() {
  let ok = 0;
  for (const t of tests) {
    try {
      t.fn();
      console.log(`✅ ${t.name}`);
      ok++;
    } catch (e) {
      console.error(`❌ ${t.name}: ${e.message}`);
    }
  }

  for (const fp of [...new Set(savedPaths)]) {
    try {
      fs.unlinkSync(fp);
    } catch {
      /* ignore */
    }
  }

  if (ok !== tests.length) process.exit(1);
  console.log(`\nOK ${ok}/${tests.length} testes promo-photo-upload`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
