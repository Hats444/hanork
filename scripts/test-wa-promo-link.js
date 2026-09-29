'use strict';

const { htmlToPlainPromo } = require('../src/utils/broadcastTextClean');
const { ensureProductBuyLink, hasTelegramBuyLink } = require('../src/utils/waPromoLink');

const html =
  'Comece a vender hoje mesmo no Telegram.<br><br><b>R$ 149,00</b><br><br>' +
  '<a href="https://t.me/hanork_bot?start=buy_15">Comprar agora</a>';

const plain = htmlToPlainPromo(html, { productId: 15, username: 'hanork_bot' });
console.log('htmlToPlainPromo:', plain);
console.assert(hasTelegramBuyLink(plain), 'htmlToPlainPromo must keep buy link');

const noLink = 'Comece a vender hoje mesmo.\nGerencie seu catálogo.\n\nR$ 149,00';
const fixed = ensureProductBuyLink(noLink, 15, 'hanork_bot');
console.log('ensureProductBuyLink:', fixed);
console.assert(hasTelegramBuyLink(fixed), 'ensureProductBuyLink must append buy link');

const zeroDivu = require('../zero-divu/src/utils/waPromoLink');
const zFixed = zeroDivu.ensureProductBuyLink(noLink, 15);
console.log('zero-divu ensure:', zFixed.slice(-60));
console.assert(zeroDivu.hasTelegramBuyLink(zFixed), 'zero-divu helper must append link');

console.log('OK — all buy-link checks passed');
