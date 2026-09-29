'use strict';
const path = require('path');
const fs = require('fs');
const {
  resolveProductPhotoInput,
  resolveProductPhotoWithMenuFallback,
} = require('../src/utils/productPhoto');
const { CONFIG } = require('../src/config/config');

const photosDir = CONFIG.CAMINHO_FOTOS;
const Database = require('better-sqlite3');
const dbPath = process.env.HANORK_DB || path.join(process.env.HOME || '', '.hanork/hanork.db');
const rows = new Database(dbPath)
  .prepare('SELECT id, name, photo FROM products WHERE active = 1 ORDER BY id')
  .all();

console.log('fotos dir:', photosDir, fs.existsSync(photosDir) ? 'OK' : 'MISSING');
for (const p of rows) {
  const direct = resolveProductPhotoInput(p, photosDir);
  const { photo, usedMenuFallback } = resolveProductPhotoWithMenuFallback(p, photosDir, `test:${p.id}`);
  const src =
    typeof photo === 'string'
      ? photo
      : photo?.source
        ? path.basename(String(photo.source))
        : '(none)';
  console.log(
    `#${p.id} ${p.name}`,
    '| db:', p.photo || '-',
    '| prod:', direct ? path.basename(String(direct?.source || direct)) : 'NO',
    '| final:', src,
    usedMenuFallback ? '(menu)' : '(produto)'
  );
}
