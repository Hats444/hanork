#!/usr/bin/env node
/**
 * Smoke: valida init de callbacks sem subir polling do Telegram
 */
'use strict';

process.env.SMOKE_BOOT = '1';

const path = require('path');
require('../src/config/env');

const { Telegraf } = require('telegraf');
const { registry } = require('../src/core/CallbackRegistry');
const { registerCallbacks } = require('../src/bot/bootstrap/registerCallbacks');

if (!process.env.TOKEN_TELEGRAM) {
    console.error('SKIP: TOKEN_TELEGRAM ausente no .env');
    process.exit(0);
}

const bot = new Telegraf(process.env.TOKEN_TELEGRAM);

const deps = {
    bot,
    stateManager: require('../src/infrastructure').stateManager,
    sendMainMenu: async () => {},
    showCatalog: async () => {},
    showCart: async () => {},
    cartKey: () => 1,
    Cart: { items: async () => [], totalWithDiscount: async () => 0, clear: async () => {} },
    createOrder: async () => ({ id: 'test', external_reference: 'x' }),
    prisma: require('../src/config/database').prisma,
    comprasPendentes: { get: async () => null, set: async () => {}, delete: async () => {} },
    getAffSaldo: async () => 0,
    checkCheckoutCooldown: async () => ({ allowed: true }),
    Menu: { pagamento: () => ({ reply_markup: { inline_keyboard: [] } }) },
    Markup: require('telegraf').Markup,
    Msg: { edit: async () => {}, reply: async () => {} },
    cuponsAplicados: { get: async () => null },
    deliverProducts: async () => {},
    payAffiliateCommission: async () => {},
};

registerCallbacks(bot, deps, []);
console.log('SMOKE OK — callbacks:', registry.stats.registered);
