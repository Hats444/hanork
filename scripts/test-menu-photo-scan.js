#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hanork-menu-'));
const infos = path.join(tmp, 'infos');
fs.mkdirSync(infos);

for (const name of ['menu5.jpg', 'menu.jpg', 'menu3.png', 'menu2.webp', 'not-menu.jpg', 'menuX.jpg', 'produto-cap.jpg']) {
  fs.writeFileSync(path.join(infos, name), 'x');
}

process.env.CAMINHO_INFOS = infos;

const modPath = path.join(__dirname, '..', 'src', 'telegram', 'menuPhoto.js');
delete require.cache[require.resolve(modPath)];
const {
  listExistingMenuFiles,
  scanMenuPhotosInDir,
  menuSortKey,
  warmMenuPhotoCache,
  invalidateMenuPhotoCache,
} = require(modPath);

const files = scanMenuPhotosInDir(infos);
const names = files.map((f) => path.basename(f));

const expect = ['menu.jpg', 'menu2.webp', 'menu3.png', 'menu5.jpg'];
let ok = true;

if (JSON.stringify(names) !== JSON.stringify(expect)) {
  console.error('FAIL sort/names', names, 'expected', expect);
  ok = false;
} else {
  console.log('OK scan + sort:', names.join(', '));
}

if (names.includes('not-menu.jpg') || names.includes('produto-cap.jpg')) {
  console.error('FAIL menu scan must ignore non-menu*.jpg files', names);
  ok = false;
} else {
  console.log('OK ignores product/random images in infos/');
}

if (menuSortKey('menu.jpg') !== 1 || menuSortKey('menu10.jpg') !== 10) {
  console.error('FAIL menuSortKey');
  ok = false;
} else {
  console.log('OK menuSortKey');
}

const listed = listExistingMenuFiles()
  .filter((f) => f.startsWith(path.normalize(infos)))
  .map((f) => path.basename(f));
if (JSON.stringify(listed) !== JSON.stringify(expect)) {
  console.error('FAIL listExistingMenuFiles', listed);
  ok = false;
} else {
  console.log('OK listExistingMenuFiles from CAMINHO_INFOS');
}

invalidateMenuPhotoCache();
const cached1 = warmMenuPhotoCache().length;
invalidateMenuPhotoCache();
fs.writeFileSync(path.join(infos, 'menu4.jpg'), 'y');
const cached2 = warmMenuPhotoCache().length;
if (cached2 !== cached1 + 1) {
  console.error('FAIL cache fingerprint after menu4.jpg', cached1, '->', cached2);
  ok = false;
} else {
  console.log('OK cache refresh on new menu4.jpg');
}

try {
  fs.rmSync(tmp, { recursive: true, force: true });
} catch {
  /* ignore */
}

delete process.env.CAMINHO_INFOS;

console.log(ok ? '\n--- menu photo scan OK ---' : '\n--- FAIL ---');
process.exit(ok ? 0 : 1);
