'use strict';

require('dotenv').config();
const { Telegraf } = require('telegraf');
const { fetchTelegramProfile } = require('../src/services/TelegramProfileSyncService');

const token = process.env.TOKEN_TELEGRAM || process.env.BOT_TOKEN;
if (!token) {
    console.error('TOKEN_TELEGRAM missing');
    process.exit(1);
}

const bot = new Telegraf(token);
const testId = process.argv[2] || '8374207443';

fetchTelegramProfile(bot, testId)
    .then((r) => {
        console.log(JSON.stringify(r, null, 2));
        process.exit(r.ok ? 0 : 1);
    })
    .catch((e) => {
        console.error(e);
        process.exit(1);
    });
