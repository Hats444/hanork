#!/usr/bin/env node
'use strict';

/**
 * Gera TELEGRAM_USER_SESSION para a ponte MTProto (/entrar em grupos públicos).
 * Uso: node scripts/telegram-user-login.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const readline = require('readline');
const path = require('path');

async function ask(rl, q) {
    return new Promise((resolve) => rl.question(q, resolve));
}

async function main() {
    let TelegramClient;
    let StringSession;
    try {
        ({ TelegramClient } = require('telegram'));
        ({ StringSession } = require('telegram/sessions'));
    } catch {
        console.error('Instale antes: npm install telegram');
        process.exit(1);
    }

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    let apiId = parseInt(process.env.TELEGRAM_USER_API_ID || '', 10);
    let apiHash = process.env.TELEGRAM_USER_API_HASH || '';

    if (!apiId) {
        apiId = parseInt(await ask(rl, 'API ID (my.telegram.org): '), 10);
    }
    if (!apiHash) {
        apiHash = await ask(rl, 'API Hash: ');
    }

    const session = new StringSession(process.env.TELEGRAM_USER_SESSION || '');
    const client = new TelegramClient(session, apiId, apiHash, { connectionRetries: 5 });

    console.log('\nConectando… (pode pedir telefone e código do Telegram)\n');

    await client.start({
        phoneNumber: async () => await ask(rl, 'Seu telefone (+55…): '),
        password: async () => await ask(rl, 'Senha 2FA (se tiver, senão Enter): '),
        phoneCode: async () => await ask(rl, 'Código SMS/Telegram: '),
        onError: (err) => console.error(err),
    });

    const saved = client.session.save();
    console.log('\n✅ Sessão criada. Cole no .env:\n');
    console.log(`TELEGRAM_USER_API_ID=${apiId}`);
    console.log(`TELEGRAM_USER_API_HASH=${apiHash}`);
    console.log(`TELEGRAM_USER_SESSION=${saved}`);
    console.log('\nDepois: pm2 restart hanork-bot\n');

    await client.disconnect();
    rl.close();
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
