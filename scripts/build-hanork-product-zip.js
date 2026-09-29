#!/usr/bin/env node
'use strict';

/**
 * Gera produtos/hanork-bot-v3.zip — pacote limpo para venda (sem dados sensíveis).
 * Atualiza o produto no SQLite (id 15 por padrão).
 *
 * Uso: node scripts/build-hanork-product-zip.js
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const { formatAllVariantsBonusFile } = require('../src/data/hanorkBroadcastVariants');

const ROOT = path.resolve(__dirname, '..');
const OUT_ZIP = path.join(ROOT, 'produtos', 'hanork-bot-v3.zip');
const PRODUCT_ID = parseInt(process.env.HANORK_PRODUCT_ID || '15', 10);
const INCLUDE_NODE_MODULES = process.env.HANORK_ZIP_NODE_MODULES !== '0';

const EXCLUDE_DIRS = new Set([
    '.git',
    'backups',
    'logs',
    'uploads',
    'produtos',
    'fotos',
    'infos',
    'database',
    'agent-transcripts',
    '.cursor',
    'terminals',
    'shared',
    '.hanork',
]);

if (!INCLUDE_NODE_MODULES) {
    EXCLUDE_DIRS.add('node_modules');
}

const EXCLUDE_FILES = new Set([
    '.env',
    '.bot.lock',
    '.bot-state.json',
    'hanork.db',
    'dev.db',
    'hanork-bot-v3.zip',
    '.DS_Store',
]);

const EXCLUDE_EXT = ['.db', '.gz', '.zip', '.log'];
const EXCLUDE_SUFFIX = ['.db-shm', '.db-wal'];

/** Dentro de node_modules: remove só lixo seguro (não afeta runtime). */
function shouldSkipNodeModulesPart(norm) {
    if (!norm.includes('node_modules/')) return false;
    if (norm.includes('/.cache/')) return true;
    if (norm.includes('/.git/')) return true;
    if (/\/\.bin\/.*\.cmd$/i.test(norm)) return true;
    if (/\/\.bin\/.*\.ps1$/i.test(norm)) return true;
    return false;
}

function shouldSkip(relPath) {
    const norm = relPath.replace(/\\/g, '/');
    if (shouldSkipNodeModulesPart(norm)) return true;
    const parts = norm.split('/');
    if (parts.some((p) => EXCLUDE_DIRS.has(p))) return true;
    if (norm.includes('zero-divu/database/')) return true;
    if (norm.includes('zero-divu/src/media/') && !norm.endsWith('LEIA-ME.txt')) return true;
    const base = parts[parts.length - 1];
    if (EXCLUDE_FILES.has(base)) return true;
    if (base === 'terminal.log' || base.startsWith('.hanork-')) return true;
    if (base.endsWith('.bat') || base.endsWith('.ps1')) return true;
    if (base === '.env.example' || base.endsWith('.example')) return false;
    if (base.startsWith('.env')) return true;
    const ext = path.extname(base).toLowerCase();
    if (EXCLUDE_EXT.includes(ext)) return true;
    if (EXCLUDE_SUFFIX.some((s) => base.endsWith(s))) return true;
    return false;
}

function walk(dir, base = '') {
    const entries = [];
    for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
        const rel = base ? `${base}/${name.name}` : name.name;
        if (shouldSkip(rel)) continue;
        const abs = path.join(dir, name.name);
        if (name.isDirectory()) entries.push(...walk(abs, rel));
        else entries.push({ abs, rel: rel.replace(/\\/g, '/') });
    }
    return entries;
}

function writeLeiaMe() {
    return `HANORK BOT v3.0 — PACOTE DO COMPRADOR
================================

COMECE POR AQUI:
  → LEIA-ME-CLIENTE.txt   (resumo em 2 minutos)
  → CLIENTE.md            (guia completo passo a passo)
  → CREDENCIAIS-INICIAIS.txt (login do painel web)

ÚNICO PASSO OBRIGATÓRIO:
  Cole seu token do @BotFather em TOKEN_TELEGRAM no arquivo .env

NÃO execute npm install — dependências já vêm no ZIP.

Iniciar: node src/bot.js

Documentação técnica: README.md (referência para desenvolvedores)
`;
}

function writeLeiaMeCliente(dashboardPass) {
    return `HANORK — COMECE AQUI (2 MINUTOS)
==================================

1. Descompacte o ZIP e entre na pasta hanork-bot

2. Abra CREDENCIAIS-INICIAIS.txt (login do painel)

3. Edite o .env e configure OBRIGATORIAMENTE:
   • TOKEN_TELEGRAM (token do @BotFather)
   • ID_DONO (seu ID Telegram — envie /id ao bot depois de subir)
   • TOKEN_MP (Access Token do Mercado Pago)

4. No Ubuntu/WSL/VPS:
   node src/bot.js

   Pronto. O resto é automático.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

O QUE JÁ VEM NO PACOTE
  ✓ Dependências + Baileys patchado (não rode npm install)
  ✓ Bancos zerados em ~/.hanork e ~/.zero-divu (na 1ª execução)
  ✓ Chaves de segurança únicas deste ZIP (JWT, IPC, painel)
  ✓ Guia CLIENTE.md + textos de divulgação (DIVULGACAO-HANORK-PRO.txt)

NÃO VEM (você coloca os seus — por segurança)
  ✗ Token do seu bot antigo
  ✗ Mercado Pago de outra pessoa
  ✗ E-mail, CPF ou clientes de outro vendedor

DEPOIS QUE SUBIR
  • Telegram: /admin no seu bot
  • Painel web: http://localhost:3000/dashboard
    Login: admin / ${dashboardPass}
  • WhatsApp: /wa → escanear QR

NÃO FAÇA
  ✗ npm install (quebra o Baileys)
  ✗ Copiar .env de outra instalação

SE DER ERRO DE better-sqlite3:
  npm rebuild better-sqlite3

Guia completo: CLIENTE.md
`;
}

function generateIpcToken() {
    return crypto.randomBytes(32).toString('hex');
}

function generateSecret(bytes = 32) {
    return crypto.randomBytes(bytes).toString('hex');
}

function generateDashboardPass() {
    const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let out = '';
    for (let i = 0; i < 12; i++) {
        out += chars[crypto.randomInt(chars.length)];
    }
    return out;
}

function buildClientCredentials(dashboardPass) {
    return `HANORK — CREDENCIAIS INICIAIS
=============================
(guarde em local seguro — não compartilhe)

PAINEL WEB
  URL:      http://localhost:3000/dashboard
  Usuário:  admin
  Senha:    ${dashboardPass}

CONFIGURE NO .env (obrigatório — dados do COMPRADOR)
  TOKEN_TELEGRAM=...     → @BotFather
  ID_DONO=...            → seu ID Telegram (/id no bot)
  TOKEN_MP=...           → Mercado Pago Developers

JÁ GERADO NESTE ZIP (únicos desta cópia)
  • ZERO_IPC_TOKEN (Hanork ↔ WhatsApp)
  • DASHBOARD_JWT_SECRET / ENCRYPTION_KEY
  • Senha do painel acima

INICIAR
  node src/bot.js

Mais detalhes: CLIENTE.md
`;
}

function writeClienteMd(dashboardPass) {
    return `# Hanork Bot v3 — Guia do Cliente

> Pacote limpo para o **comprador**. Configure **seu** Telegram, **seu** ID e **seu** Mercado Pago no \`.env\`.

---

## Passo a passo (primeira vez)

### 1. Descompactar

\`\`\`bash
unzip hanork-bot-v3.zip
cd hanork-bot
\`\`\`

### 2. Configurar o .env (obrigatório)

1. Abra o [@BotFather](https://t.me/BotFather) → crie um bot → copie o token
2. Edite \`.env\` na pasta \`hanork-bot\`:
   - \`TOKEN_TELEGRAM=\` seu token
   - \`ID_DONO=\` seu ID Telegram (depois de subir, envie \`/id\` ao bot)
   - \`TOKEN_MP=\` Access Token do [Mercado Pago Developers](https://www.mercadopago.com.br/developers)
3. Opcional: e-mail/CPF em \`MP_PAYER_*\` se o PIX exigir na sua conta MP

### 3. Iniciar

\`\`\`bash
node src/bot.js
\`\`\`

**Não rode \`npm install\`.** As dependências já vêm no ZIP, inclusive o Baileys patchado para WhatsApp Status.

Se aparecer erro de \`better-sqlite3\`:

\`\`\`bash
npm rebuild better-sqlite3
node src/bot.js
\`\`\`

---

## O que acontece automaticamente

Na **primeira execução**:

| Ação | Detalhe |
|------|---------|
| Pastas | \`~/.hanork/\`, \`~/.zero-divu/\`, \`produtos/\`, \`shared/zero-ipc/\` |
| Bancos | \`~/.hanork/hanork.db\` (loja) e \`~/.zero-divu/zero-divu.db\` (WhatsApp) |
| Tabelas | Produtos, pedidos, cupons, usuários — zerados, prontos para usar |
| IPC WhatsApp | Comunicação Hanork ↔ Zero Divu |
| Patch Baileys | Ajustado para postar nos **Status** do WhatsApp |
| Terminal | Banner + dashboard (1ª vez que abre terminal no Linux) |

Ao **reabrir o Ubuntu**:

- O **primeiro terminal** sobe o bot sozinho (\`HANORK_AUTOSTART=1\`)
- Mostra banner + status do sistema
- Fechar o terminal **não para** o bot

---

## Painel web

| Campo | Valor |
|-------|-------|
| URL | http://localhost:3000/dashboard |
| Usuário | admin |
| Senha | ${dashboardPass} |

Também em **CREDENCIAIS-INICIAIS.txt**.

---

## WhatsApp (Status)

1. Com o bot rodando, abra seu bot no Telegram
2. Envie \`/wa\` (como admin)
3. Escaneie o QR Code
4. Divulgação nos Status via \`/wa_*\` ou painel admin

---

## Comandos no terminal

| Comando | Função |
|---------|--------|
| hanork-start | Sobe o bot + logs |
| hanork-stop | Para o bot |
| hanork-status | Verifica se está rodando |
| hanork-restart | Reinicia |
| hanork-logs | Logs ao vivo |

---

## Mercado Pago — webhook (quando tiver domínio)

Sem webhook, o PIX ainda confirma por polling automático.

Com HTTPS:

1. \`WEBHOOK_URL=https://SEU_DOMINIO/webhooks/mercadopago\` no \`.env\`
2. Mesma URL no painel Mercado Pago → Webhooks
3. Secret do MP em \`MP_WEBHOOK_SECRET\`
4. \`hanork-restart\`

---

## Redis (opcional)

Funciona sem Redis. Para filas mais rápidas:

\`\`\`bash
sudo apt install redis-server
sudo systemctl enable --now redis-server
\`\`\`

---

## Problemas comuns

| Problema | Solução |
|----------|---------|
| TOKEN_TELEGRAM placeholder | Cole token do BotFather no \`.env\` |
| better-sqlite3 inválido | \`npm rebuild better-sqlite3\` |
| Bot não sobe no terminal | \`hanork-start\` |
| Desativar autostart | \`HANORK_AUTOSTART=0\` no \`.env\` |
| Restaurar terminal | \`npm run terminal:restore\` |

---

## Arquivos do pacote

| Arquivo | Conteúdo |
|---------|----------|
| LEIA-ME-CLIENTE.txt | Resumo rápido |
| CLIENTE.md | Este guia |
| CREDENCIAIS-INICIAIS.txt | Login do painel |
| README.md | Documentação técnica |

---

*Hanork Bot v3.0 — Suporte conforme combinado com o vendedor.*
`;
}

function buildClientEnv(ipcToken, secrets) {
    const examplePath = path.join(ROOT, '.env.example');
    let text = fs.readFileSync(examplePath, 'utf8');

    const replacements = [
        [/^TOKEN_TELEGRAM=.*$/m, 'TOKEN_TELEGRAM=COLE_SEU_TOKEN_DO_BOTFATHER_AQUI'],
        [/^TOKEN_TELEGRAM_NOTIFY=.*$/m, 'TOKEN_TELEGRAM_NOTIFY='],
        [/^ADMIN_NOTIFY_IDS=.*$/m, 'ADMIN_NOTIFY_IDS=COLE_SEU_TELEGRAM_ID_AQUI'],
        [/^TOKEN_MP=.*$/m, 'TOKEN_MP=COLE_SEU_ACCESS_TOKEN_MERCADOPAGO_AQUI'],
        [/^ID_DONO=.*$/m, 'ID_DONO=COLE_SEU_TELEGRAM_ID_AQUI'],
        [/^MP_PAYER_EMAIL=.*$/m, 'MP_PAYER_EMAIL=seu_email@exemplo.com'],
        [/^MP_PAYER_CPF=.*$/m, 'MP_PAYER_CPF=00000000000'],
        [/^SMTP_EMAIL=.*$/m, 'SMTP_EMAIL='],
        [/^SMTP_PASSWORD=.*$/m, 'SMTP_PASSWORD='],
        [/^API_KEY_ZEROTWO=.*$/m, 'API_KEY_ZEROTWO='],
        [/^JWT_SECRET=.*$/m, `JWT_SECRET=${secrets.jwtSecret}`],
        [/^DASHBOARD_USER=.*$/m, 'DASHBOARD_USER=admin'],
        [/^DASHBOARD_PASS_HASH=.*$/m, 'DASHBOARD_PASS_HASH='],
        [/^DASHBOARD_PASS=.*$/m, `DASHBOARD_PASS=${secrets.dashboardPass}`],
        [/^DASHBOARD_JWT_SECRET=.*$/m, `DASHBOARD_JWT_SECRET=${secrets.jwtSecret}`],
        [/^ENCRYPTION_KEY=.*$/m, `ENCRYPTION_KEY=${secrets.encryptionKey}`],
        [/^WEBHOOK_URL=.*$/m, 'WEBHOOK_URL=https://SEU_DOMINIO/webhooks/mercadopago'],
        [/^MP_WEBHOOK_SECRET=.*$/m, 'MP_WEBHOOK_SECRET=COLE_SECRET_DO_PAINEL_MP_AQUI'],
        [/^ZERO_IPC_TOKEN=.*$/m, `ZERO_IPC_TOKEN=${ipcToken}`],
        [/^# ZERO_IPC_TOKEN=.*$/m, `ZERO_IPC_TOKEN=${ipcToken}`],
        [/^NODE_ENV=.*$/m, 'NODE_ENV=development'],
        [/^ZERO_DIVU_ENABLED=.*$/m, 'ZERO_DIVU_ENABLED=true'],
        [/^REDIS_URL=.*$/m, 'REDIS_URL=redis://127.0.0.1:6379'],
        [/^REDIS_FAIL_CLOSED_ENABLED=.*$/m, 'REDIS_FAIL_CLOSED_ENABLED=0'],
        [/^REDIS_STATE_FAIL_CLOSED_ENABLED=.*$/m, 'REDIS_STATE_FAIL_CLOSED_ENABLED=0'],
        [/^ADMIN_NOTIFY_USE_QUEUE=.*$/m, 'ADMIN_NOTIFY_USE_QUEUE=0'],
        [/^DASHBOARD_TENANT_AUDIT=.*$/m, 'DASHBOARD_TENANT_AUDIT=1'],
        [/^DASHBOARD_TENANT_ENFORCE=.*$/m, 'DASHBOARD_TENANT_ENFORCE=0'],
        [/^ZEROTWO_API_KEY_REQUIRED=.*$/m, 'ZEROTWO_API_KEY_REQUIRED=0'],
        [/^ZERO_IPC_AUTH_REQUIRED=.*$/m, 'ZERO_IPC_AUTH_REQUIRED=1'],
        [/^HANORK_MENU_V4=.*$/m, 'HANORK_MENU_V4=1'],
        [/^HANORK_AUTOSTART=.*$/m, 'HANORK_AUTOSTART=1'],
        [/^# ZERO_DIVU_IPC_DIR=.*$/m, 'ZERO_DIVU_IPC_DIR=./shared/zero-ipc'],
        [/^# HANORK_DB_PATH=.*$/m, 'HANORK_DB_PATH=~/.hanork/hanork.db'],
        [/^# ZERO_DIVU_DB_PATH=.*$/m, 'ZERO_DIVU_DB_PATH=~/.zero-divu/zero-divu.db'],
        [/^TELEGRAM_USER_SESSION=.*$/m, 'TELEGRAM_USER_SESSION='],
        [/^TELEGRAM_USER_API_ID=.*$/m, 'TELEGRAM_USER_API_ID='],
        [/^TELEGRAM_USER_API_HASH=.*$/m, 'TELEGRAM_USER_API_HASH='],
    ];

    for (const [re, val] of replacements) {
        if (re.test(text)) text = text.replace(re, val);
    }

    if (!/^HANORK_DB_PATH=/m.test(text)) text += 'HANORK_DB_PATH=~/.hanork/hanork.db\n';
    if (!/^ZERO_DIVU_DB_PATH=/m.test(text)) text += 'ZERO_DIVU_DB_PATH=~/.zero-divu/zero-divu.db\n';
    if (!/^ZERO_IPC_TOKEN=/m.test(text)) text += `ZERO_IPC_TOKEN=${ipcToken}\n`;
    if (!/^HANORK_CLIENT_PACK=/m.test(text)) text += 'HANORK_CLIENT_PACK=1\n';
    if (!/^SECURITY_STRICT=/m.test(text)) text += 'SECURITY_STRICT=false\n';

    return text;
}

function buildClientZeroDivuEnv(ipcToken) {
    return `# Zero Divu — worker WhatsApp (dentro do Hanork)
ZERO_DIVU_IPC_DIR=../shared/zero-ipc
ZERO_IPC_POLL_MS=500
ZERO_IPC_TOKEN=${ipcToken}
ZERO_IPC_AUTH_REQUIRED=1
ZERO_DIVU_AUTO_PROFILE=true
`;
}

async function buildZip() {
    fs.mkdirSync(path.dirname(OUT_ZIP), { recursive: true });
    const oldZips = [
        OUT_ZIP,
        path.join(ROOT, 'hanork-bot-v3.zip'),
        path.join(ROOT, 'produtos', 'hanork.zip'),
    ];
    for (const z of oldZips) {
        if (fs.existsSync(z)) {
            fs.unlinkSync(z);
            console.log('Removido:', z);
        }
    }

    const files = walk(ROOT);
    await new Promise((resolve, reject) => {
        const output = fs.createWriteStream(OUT_ZIP);
        const archive = archiver('zip', { zlib: { level: 9 } });
        output.on('close', resolve);
        archive.on('error', reject);
        archive.pipe(output);

        archive.append(writeLeiaMe(), { name: 'hanork-bot/LEIA-ME.txt' });

        const prefix = 'hanork-bot';
        const ipcToken = generateIpcToken();
        const secrets = {
            encryptionKey: generateSecret(32),
            jwtSecret: generateSecret(24),
            dashboardPass: generateDashboardPass(),
        };
        archive.append(buildClientEnv(ipcToken, secrets), { name: `${prefix}/.env` });
        archive.append(buildClientZeroDivuEnv(ipcToken), { name: `${prefix}/zero-divu/.env` });
        archive.append(buildClientCredentials(secrets.dashboardPass), {
            name: `${prefix}/CREDENCIAIS-INICIAIS.txt`,
        });
        archive.append(writeLeiaMeCliente(secrets.dashboardPass), {
            name: `${prefix}/LEIA-ME-CLIENTE.txt`,
        });
        archive.append(writeClienteMd(secrets.dashboardPass), {
            name: `${prefix}/CLIENTE.md`,
        });
        archive.append(formatAllVariantsBonusFile(), { name: `${prefix}/DIVULGACAO-HANORK-PRO.txt` });
        console.log('Pacote comprador: .env limpo (sem dados do vendedor) | IPC token único');
        console.log('Dashboard: admin /', secrets.dashboardPass);

        for (const { abs, rel } of files) {
            archive.file(abs, { name: `${prefix}/${rel}` });
        }
        archive.finalize();
    });

    const stat = fs.statSync(OUT_ZIP);
    console.log('ZIP criado:', OUT_ZIP);
    console.log('Tamanho:', (stat.size / 1024 / 1024).toFixed(2), 'MB');
    console.log('Arquivos:', files.length);
    if (INCLUDE_NODE_MODULES) {
        const hasMain = fs.existsSync(path.join(ROOT, 'node_modules'));
        const hasZd = fs.existsSync(path.join(ROOT, 'zero-divu/node_modules'));
        console.log('node_modules:', hasMain ? 'incluído' : 'AUSENTE — rode npm install antes do build');
        console.log('zero-divu/node_modules:', hasZd ? 'incluído' : 'AUSENTE — rode npm install em zero-divu/');
    }
}

function updateProduct() {
    process.env.DATABASE_URL = process.env.DATABASE_URL || 'file:./hanork.db';
    const { connect } = require('../src/config/database-sqlite');
    const db = connect();

    const name = 'Hanork PRO v3.0 — Loja Automática Telegram';
    const price = Number(process.env.HANORK_PRODUCT_PRICE || '297.9');
    const description =
        '🤖 <b>Hanork PRO v3.0</b> — loja automática no Telegram\n\n' +
        'PIX + entrega automática + divulgação inteligente (edita, não spamma).\n\n' +
        '<b>O que você recebe:</b>\n' +
        '✅ Catálogo, carrinho, cupom e checkout no PV\n' +
        '✅ PIX e cartão (Mercado Pago)\n' +
        '✅ Entrega automática de digitais\n' +
        '✅ Painel <code>/admin</code> + dashboard web\n' +
        '✅ Flash sale, afiliados, CRM, WhatsApp Status (opcional)\n' +
        '✅ ZIP <b>limpo</b> — sem tokens nem dados de outro cliente\n' +
        '✅ Bônus: <code>DIVULGACAO-HANORK-PRO.txt</code> (20 textos góticos prontos)\n\n' +
        '⚡ Entrega automática após pagar\n' +
        '🛒 <code>t.me/hanork_bot?start=buy_15</code>\n\n' +
        '<i>Você configura seu BotFather, ID_DONO e Mercado Pago no .env.</i>';

    const row = db.prepare('SELECT id FROM products WHERE id = ?').get(PRODUCT_ID);
    if (!row) {
        db.prepare(
            `INSERT INTO products (name, price, description, file_url, category, stock, active, tenant_id)
             VALUES (?, ?, ?, 'hanork-bot-v3.zip', 'bots', 999, 1, NULL)`
        ).run(name, price, description);
        console.log('Produto criado no banco.');
    } else {
        db.prepare(
            `UPDATE products SET name = ?, price = ?, description = ?, file_url = 'hanork-bot-v3.zip',
             category = 'bots', active = 1, stock = 999 WHERE id = ?`
        ).run(name, price, description, PRODUCT_ID);
        console.log('Produto atualizado id', PRODUCT_ID);
    }
}

async function main() {
    await buildZip();
    try {
        updateProduct();
    } catch (e) {
        console.warn('Aviso: produto no SQLite não atualizado (ZIP já gerado):', e.message);
    }
    console.log('\nPronto — produto hanork-bot-v3.zip na pasta produtos/');
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
