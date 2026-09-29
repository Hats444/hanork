'use strict';
const path = require('path');
const fs = require('fs');
const {
  writeHanorkOnlyCatalogFile,
  formatAllVariantsBonusFile,
  listHanorkPromoPhotos,
} = require('../src/data/hanorkBroadcastVariants');

const root = path.join(__dirname, '..');
const photosDir = path.join(root, 'fotos');
const { HANORK_PRODUCT_ID } = require('../src/constants/hanorkProduct');
const p = { id: HANORK_PRODUCT_ID, name: 'Hanork PRO v3.0', price: 297.9 };

writeHanorkOnlyCatalogFile(p, { username: 'hanork_bot', photosDir });
fs.writeFileSync(
  path.join(photosDir, 'DIVULGACAO-HANORK-PRO.txt'),
  formatAllVariantsBonusFile(photosDir),
  'utf8'
);
console.log('Fotos:', listHanorkPromoPhotos(photosDir).join(', '));
