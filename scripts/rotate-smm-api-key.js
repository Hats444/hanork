#!/usr/bin/env node
'use strict';

/**
 * Rotaciona FORNECEDOR_BRASIL_API_KEY com validação prévia.
 *
 * Uso:
 *   SMM_API_KEY_NEW=sua_nova_key node scripts/rotate-smm-api-key.js
 *   SMM_API_KEY_NEW=sua_nova_key node scripts/rotate-smm-api-key.js --apply
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

process.chdir(path.join(__dirname, '..'));
require('../src/config/env');

const APPLY = process.argv.includes('--apply');
const newKey =
  (process.env.SMM_API_KEY_NEW || '').trim() ||
  (() => {
    const i = process.argv.indexOf('--key');
    return i >= 0 ? String(process.argv[i + 1] || '').trim() : '';
  })();

const envPath = path.join(process.cwd(), '.env');

function testKey(key) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams({ key, action: 'balance' }).toString();
    const url = new URL(
      (process.env.FORNECEDOR_BRASIL_API_URL || 'https://fornecedorbrasil.com/api/v2').trim()
    );
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 20000,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => {
          data += c;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error(`Resposta inválida: ${data.slice(0, 120)}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.write(body);
    req.end();
  });
}

async function main() {
  if (!newKey || newKey.length < 8) {
    console.error('Defina SMM_API_KEY_NEW ou --key <nova_key>');
    process.exit(1);
  }

  const oldKey = (process.env.FORNECEDOR_BRASIL_API_KEY || '').trim();
  if (oldKey === newKey) {
    console.error('Nova key igual à atual — nada a fazer.');
    process.exit(1);
  }

  console.log('Validando nova key na API FornecedorBrasil…');
  const result = await testKey(newKey);
  if (result.error) {
    console.error('Key inválida:', result.message || result.error);
    process.exit(1);
  }

  console.log('OK — saldo:', result.balance, result.currency || 'BRL');
  console.log('Modo:', APPLY ? 'APLICAR' : 'dry-run (use --apply)');

  if (!APPLY) return;

  const backup = `${envPath}.bak-${Date.now()}`;
  const raw = fs.readFileSync(envPath, 'utf8');
  fs.writeFileSync(backup, raw);

  const lineRe = /^FORNECEDOR_BRASIL_API_KEY=.*/m;
  const next = lineRe.test(raw)
    ? raw.replace(lineRe, `FORNECEDOR_BRASIL_API_KEY=${newKey}`)
    : `${raw.trimEnd()}\nFORNECEDOR_BRASIL_API_KEY=${newKey}\n`;

  fs.writeFileSync(envPath, next);
  console.log(`Atualizado .env · backup: ${path.basename(backup)}`);
  console.log('Reinicie o bot: bash scripts/hanork-ctl.sh restart');
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
