'use strict';

const { sanitizeWaCaption } = require('../zero-divu/src/utils/statusCaptionSanitizer');
const { buildWaPlainPromo, buildWaPlainFromParts } = require('../src/utils/persuasiveProductCopy');
const { withPromoTemplate } = require('../src/data/productPromoTemplates');

const samples = [
  {
    name: 'hanork duplicate price',
    text: `Hanork PRO v3.0 — loja automática no Telegram.
PIX confirma sozinho e entrega na hora.

R$ 297.90

Comprar agora — R$ 297.90
https://t.me/hanork_bot?start=buy_15
Entrega automática após confirmação do PIX.`,
  },
  {
    name: 'template double cta',
    text: `✨ Divulgador

Software para envio em massa de mensagens a grupos e contatos no WhatsApp.

💰 Por apenas R$ 59.90
⏳ Estoque digital limitado — garanta o seu antes que suba.

🛒 Garanta agora:
https://t.me/hanork_bot?start=buy_12
✅ Pagamento confirmado = entrega automática.

🛒 Comprar agora:
https://t.me/hanork_bot?start=buy_12`,
  },
];

let ok = 0;
for (const s of samples) {
  const out = sanitizeWaCaption(s.text, { productName: 'test' });
  const priceCount = (out.match(/(?<![—\-])\bR\$\s*\d/gi) || []).length;
  const linkCount = (out.match(/t\.me\//gi) || []).length;
  const ctaCount = (out.match(/comprar agora|garanta agora|quero comprar/gi) || []).length;
  console.log('\n---', s.name, '---');
  console.log(out);
  console.log({ priceCount, linkCount, ctaCount });
  if (priceCount <= 1 && linkCount <= 1 && ctaCount <= 1) {
    ok++;
    console.log('OK');
  } else {
    console.log('FAIL');
    process.exitCode = 1;
  }
}

const wa = buildWaPlainPromo(
  withPromoTemplate({ id: 15, name: 'Hanork PRO v3.0', price: 297.9, description: '' }),
  { username: 'hanork_bot' }
);
if (!/Comprar agora|Garanta agora/i.test(wa)) {
  console.error('FAIL buildWaPlainPromo sem CTA');
  process.exitCode = 1;
} else {
  ok++;
  console.log('\nOK buildWaPlainPromo estruturado');
}

const parts = buildWaPlainFromParts({
  productName: 'Teste',
  body: 'Corpo único sem repetição.',
  priceLabel: 'R$ 10.00',
  botLink: 'https://t.me/hanork_bot?start=buy_1',
});
if ((parts.match(/R\$\s*\d/gi) || []).length !== 1) {
  console.error('FAIL buildWaPlainFromParts preço duplicado');
  process.exitCode = 1;
} else {
  ok++;
  console.log('OK buildWaPlainFromParts');
}

console.log(`\n${ok} checks passed`);
