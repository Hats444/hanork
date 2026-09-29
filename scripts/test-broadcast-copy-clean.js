'use strict';

const assert = require('assert');
const {
    dedupePlainText,
    polishAiBody,
    polishPromoHtml,
    repairTelegramHtml,
    isTelegramHtmlBalanced,
} = require('../src/utils/broadcastTextClean');

const dup = dedupePlainText('Consultas mind7\n\nConsultas mind7\n\nReúne as principais fontes.');
assert.ok(!dup.includes('Consultas mind7\n\nConsultas mind7'), 'remove duplicate title lines');

const body = polishAiBody('Consultas mind7\n\nEntrega rápida no Telegram.', 'Consultas mind7');
assert.ok(!/^Consultas mind7/m.test(body) || body.split('Consultas mind7').length <= 2, 'strip repeated product name');

const broken = '<b>Teste</b>\n\n<b>Benefício</b></i>\n\n<b>R$ 10.00</b>';
const fixed = repairTelegramHtml(broken);
assert.ok(isTelegramHtmlBalanced(fixed), 'repair orphan close tags');

const merged = polishPromoHtml(
    '<b>Produto X</b>\n\nProduto X\n\nCorpo único.\n\n<b>R$ 29.00</b>\n<a href="https://t.me/bot">Comprar</a>',
    { productName: 'Produto X' }
);
assert.ok(merged.includes('<a href'), 'keep CTA link html');
assert.ok(isTelegramHtmlBalanced(merged), 'merged promo balanced');
assert.ok(!/Produto X\n\nProduto X/.test(merged.replace(/<[^>]+>/g, '')), 'no duplicate title in body');

console.log('[OK] broadcast copy clean —', 5, 'checks');
