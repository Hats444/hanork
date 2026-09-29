'use strict';
require('dotenv').config();
const axios = require('axios');
const { sanitizeAiBodyText } = require('../src/utils/aiContentSanitizer');
const { polishAiBody } = require('../src/utils/broadcastTextClean');

const q =
  '[PAPEL] Copywriter de vendas do Hanork para Telegram. Escreva APENAS o corpo da divulgação. ' +
  'HTML permitido APENAS: b, i, u, s. Sem emojis. Português BR. 3 a 5 frases. ' +
  '[PRODUTO] Nome: hanork. Preço: R$ 29.90.';

const queries = {
  long: q,
  short:
    'Escreva 4 frases de venda em português BR para o produto digital "hanork" por R$29,90. ' +
    'Use HTML com tags b e i. Sem links. Sem emojis. Sem se apresentar. Só o texto promocional.',
  minimal: 'Texto promocional curto em português sobre assinatura hanork R$29,90. HTML b/i. 3 frases.',
};

async function tryPath(path, query) {
  const base = String(process.env.ZEROTWO_API || '').replace(/\/$/, '');
  const key = process.env.API_KEY_ZEROTWO || '';
  const url = `${base}${path}?query=${encodeURIComponent(query)}&apikey=${encodeURIComponent(key)}`;
  const res = await axios.get(url, { timeout: 50000, validateStatus: () => true });
  const raw = res.data?.resultado ?? res.data?.result ?? res.data?.resposta ?? '';
  const polished = polishAiBody(String(raw).trim(), 'hanork');
  const body = sanitizeAiBodyText(polished, { productName: 'hanork' });
  console.log(path, 'status', res.status, 'rawLen', String(raw).length, 'bodyOk', !!body);
  if (raw) console.log('  raw:', String(raw).slice(0, 200));
  if (body) console.log('  body:', body.slice(0, 200));
}

async function main() {
  for (const [name, query] of Object.entries(queries)) {
    console.log('\n--- query:', name, '---');
    await tryPath('/api/ia/zerotwo', query);
  }
}

main().catch((e) => console.error(e.message));
