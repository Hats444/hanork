'use strict';

require('dotenv').config();
const { runProfileSync } = require('../src/jobs/schedulers/telegramProfileSyncScheduler');
const logger = require('../src/config/logger');
const { Telegraf } = require('telegraf');

const bot = new Telegraf(process.env.TOKEN_TELEGRAM || process.env.BOT_TOKEN);

runProfileSync({ bot, log: logger })
    .then((r) => {
        console.log('profile sync result:', r);
        process.exit(0);
    })
    .catch((e) => {
        console.error(e);
        process.exit(1);
    });
