'use strict';
const s = require('../src/telegram/screenPhoto');
const ig = s.findScreenFile('instagram');
const photo = s.getScreenPhotoInput('instagram', 1);
console.log('findScreenFile(instagram):', ig);
console.log('getScreenPhotoInput(instagram):', photo);
if (ig) process.exit(1);
if (!photo || !photo.source) process.exit(2);
console.log('OK — usando menu fallback:', photo.source);
