'use strict';
const menuPhoto = require('../src/telegram/menuPhoto');
const { resolvePhotoInput } = require('../src/telegram/messageDelivery');

const files = menuPhoto.warmMenuPhotoCache();
console.log('menu files:', files.length, files.map((f) => f.split(/[/\\]/).pop()));

const input = menuPhoto.getMenuPhotoInput(123456789);
console.log('input:', input);

const resolved = resolvePhotoInput(input);
console.log('resolved:', resolved);

if (!resolved?.source) {
  console.error('FAIL: menu photo did not resolve');
  process.exit(1);
}
console.log('OK menu photo resolves to', resolved.source);
