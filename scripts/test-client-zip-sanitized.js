#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ZIP = path.join(__dirname, '..', 'produtos', 'hanork-bot-v3.zip');
const FORBIDDEN = [
    /APP_USR-\d{12,}-\d+-[a-f0-9]{20,}-\d+/i,
    /8466894291:/,
    /8576299358:/,
    /8145550156/,
    /50278884814/,
    /bootsdeplantao@gmail/i,
    /kcyu saew fovn fqhy/i,
    /\$2b\$12\$/,
];

const REQUIRED = [
    'COLE_SEU_TOKEN_DO_BOTFATHER_AQUI',
    'COLE_SEU_ACCESS_TOKEN_MERCADOPAGO_AQUI',
    'COLE_SEU_TELEGRAM_ID_AQUI',
];

function extractEnvFromZip(zipPath) {
    const script = path.join(__dirname, '_zip_read_env.py');
    fs.writeFileSync(
        script,
        `import zipfile, sys
z = zipfile.ZipFile(sys.argv[1])
print(z.read('hanork-bot/.env').decode('utf-8', errors='replace'))
`
    );
    try {
        return execSync(`python3 "${script}" "${zipPath}"`, {
            encoding: 'utf8',
            maxBuffer: 2 * 1024 * 1024,
        });
    } catch {
        return execSync(`python "${script}" "${zipPath}"`, {
            encoding: 'utf8',
            maxBuffer: 2 * 1024 * 1024,
        });
    }
}

if (!fs.existsSync(ZIP)) {
    console.error('ZIP não encontrado:', ZIP);
    process.exit(1);
}

const env = extractEnvFromZip(ZIP);
let failed = 0;

for (const r of REQUIRED) {
    if (!env.includes(r)) {
        console.error('FAIL: placeholder ausente:', r);
        failed++;
    }
}

for (const re of FORBIDDEN) {
    if (re.test(env)) {
        console.error('FAIL: dado sensível no .env do ZIP:', String(re));
        failed++;
    }
}

if (failed) {
    console.error(`\n${failed} problema(s) — ZIP NÃO está seguro para venda\n`);
    process.exit(1);
}

console.log('OK — .env do ZIP limpo (sem dados do vendedor)');

try {
    fs.unlinkSync(path.join(__dirname, '_zip_read_env.py'));
} catch {
    /* ignore */
}
