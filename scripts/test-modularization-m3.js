#!/usr/bin/env node
'use strict';

/** M3 — módulos de comandos de usuário existem e exportam registradores */
const assert = require('assert');
const fs = require('fs');

let failed = 0;
function test(name, fn) {
    try {
        fn();
        console.log('  OK', name);
    } catch (e) {
        failed++;
        console.error('  FAIL', name + ':', e.message);
    }
}

console.log('\n=== Modularization M3/M4 ===\n');

test('registerUserCommands exportado', () => {
    const mod = require('../src/telegram/commands/user/registerUserCommands');
    assert.strictEqual(typeof mod.registerUserCommands, 'function');
});

test('createCatalogHandlers exportado', () => {
    const mod = require('../src/telegram/commands/user/catalogHandlers');
    assert.strictEqual(typeof mod.createCatalogHandlers, 'function');
});

test('registerProductAdminCommands exportado', () => {
    const mod = require('../src/telegram/commands/admin/productCommands');
    assert.strictEqual(typeof mod.registerProductAdminCommands, 'function');
});

test('bot.js compositor — bootstrapHanorkBot + registerHanorkBot', () => {
    const src = fs.readFileSync(require.resolve('../src/bot.js'), 'utf8');
    assert.ok(src.includes('bootstrapHanorkBot'));
    assert.ok(src.includes('createBotContext'));
    assert.ok(src.split('\n').length < 50, 'bot.js compositor fino (<50 LOC)');
    const regSrc = fs.readFileSync(require.resolve('../src/bot/registerHanorkBot.js'), 'utf8');
    assert.ok(regSrc.includes('registerUserCommands'));
    assert.ok(regSrc.includes('createCatalogHandlers'));
    assert.ok(regSrc.includes('registerProductAdminCommands'));
    const bootSrc = fs.readFileSync(require.resolve('../src/bot/bootstrapHanorkBot.js'), 'utf8');
    assert.ok(bootSrc.includes('registerHanorkBot'));
});

test('M4 admin split — facade e módulos', () => {
    const admin = require('../src/telegram/commands/admin');
    assert.strictEqual(typeof admin.registerAdminHandlers, 'function');
    assert.strictEqual(typeof admin.sendProgressPanel, 'function');
    assert.strictEqual(typeof admin.updateAdminPanelMessage, 'function');

    const modules = [
        'shared',
        'deps',
        'destinationHelpers',
        'panelHandlers',
        'groupsHandlers',
        'crmHandlers',
        'broadcastHandlers',
        'ordersHandlers',
        'bridgeHandlers',
        'supportHandlers',
    ];
    for (const name of modules) {
        const mod = require(`../src/telegram/commands/admin/${name}`);
        assert.ok(Object.keys(mod).length > 0, `${name} exports vazio`);
    }
    assert.strictEqual(typeof require('../src/telegram/commands/admin/panelHandlers').registerPanelHandlers, 'function');
    assert.strictEqual(typeof require('../src/telegram/commands/admin/destinationHelpers').createDestinationHelpers, 'function');
});

test('admin.js é facade fino (M4)', () => {
    const src = fs.readFileSync(require.resolve('../src/telegram/commands/admin.js'), 'utf8');
    assert.ok(src.includes('./admin/index'));
    assert.ok(src.length < 200, 'facade deve ser curto');
});

test('SP-2 registerPaymentActions exportado', () => {
    const mod = require('../src/telegram/callbacks/payment/registerPaymentActions');
    assert.strictEqual(typeof mod.registerPaymentActions, 'function');
});

test('SP-2 bot.js delega pagamento a registerPaymentActions', () => {
    const botSrc = fs.readFileSync(require.resolve('../src/bot.js'), 'utf8');
    const finSrc = fs.readFileSync(require.resolve('../src/bot/bootstrap/finalizeBot.js'), 'utf8');
    assert.ok(botSrc.includes('finalizeBotBootstrap'));
    assert.ok(finSrc.includes('registerPaymentActions(bot'));
    assert.ok(!botSrc.includes('bot.action(/^pp_'), 'pp_ não deve estar inline em bot.js');
});

test('M3 legado p_* em catalogHandlers', () => {
    const botSrc = fs.readFileSync(require.resolve('../src/bot.js'), 'utf8');
    const ctxSrc = fs.readFileSync(require.resolve('../src/bot/createBotContext.js'), 'utf8');
    const catSrc = fs.readFileSync(require.resolve('../src/telegram/commands/user/catalogHandlers.js'), 'utf8');
    assert.ok(!botSrc.includes('bot.action(/^p_'), 'p_ não deve estar inline em bot.js');
    assert.ok(catSrc.includes('bot.action(/^p_(\\d+)$'));
    assert.ok(ctxSrc.includes('getProductById'));
    const bootSrc = fs.readFileSync(require.resolve('../src/bot/bootstrapHanorkBot.js'), 'utf8');
    assert.ok(bootSrc.includes('sendProductWithPhoto'));
});

test('B3 onboarding + order feedback modules', () => {
    assert.strictEqual(typeof require('../src/telegram/commands/user/onboardingHandlers').registerUserOnboardingHandlers, 'function');
    assert.strictEqual(typeof require('../src/telegram/commands/user/orderFeedbackHandlers').registerOrderFeedbackHandlers, 'function');
    assert.strictEqual(typeof require('../src/jobs/startupRecovery').recoverPendingPayments, 'function');
    const reg = fs.readFileSync(require.resolve('../src/telegram/commands/user/registerUserCommands.js'), 'utf8');
    assert.ok(reg.includes('onboardingHandlers'));
    assert.ok(reg.includes('orderFeedbackHandlers'));
});

test('B3 prod wizard fora de bot.js', () => {
    const botSrc = fs.readFileSync(require.resolve('../src/bot.js'), 'utf8');
    const prodCmd = fs.readFileSync(require.resolve('../src/telegram/commands/admin/productCommands.js'), 'utf8');
    const wizSrc = fs.readFileSync(require.resolve('../src/telegram/commands/admin/productWizardHandlers.js'), 'utf8');
    assert.ok(!botSrc.includes("bot.action('prod_create'"), 'prod_create não deve estar inline');
    assert.ok(wizSrc.includes("bot.action('prod_create'"));
    assert.ok(prodCmd.includes('productWizardHandlers'));
});

test('B3 duplicatas removidas de bot.js', () => {
    const botSrc = fs.readFileSync(require.resolve('../src/bot.js'), 'utf8');
    assert.ok(!botSrc.includes("bot.command('cancelar'"), 'cancelar em supportCommands');
    assert.ok(!botSrc.includes("bot.command('rastrear'"), 'rastrear em supportCommands');
    assert.ok(!botSrc.includes("bot.command('addcupom'"), 'addcupom em crmHandlers');
    assert.ok(!botSrc.includes("bot.command('reembolso'"), 'reembolso em ordersHandlers');
    assert.ok(!botSrc.includes("bot.command('flashsale'"), 'flash em flashGiveawayHandlers');
    assert.ok(!botSrc.includes("bot.command('backup'"), 'backup em panelHandlers');
    assert.ok(!botSrc.includes("bot.command('usuarios'"), 'usuarios em usersHandlers');
});

test('B3 flash + users modules', () => {
    assert.strictEqual(typeof require('../src/telegram/commands/user/flashGiveawayHandlers').registerFlashGiveawayHandlers, 'function');
    assert.strictEqual(typeof require('../src/telegram/commands/admin/usersHandlers').registerUsersHandlers, 'function');
    assert.strictEqual(typeof require('../src/telegram/commands/admin/usersHandlers').createShowUsers, 'function');
    const adminIdx = fs.readFileSync(require.resolve('../src/telegram/commands/admin/index.js'), 'utf8');
    assert.ok(adminIdx.includes('registerUsersHandlers'));
});

test('B3 batch 2 — events, start, middlewares', () => {
    assert.strictEqual(typeof require('../src/telegram/events/groupEvents').registerGroupEvents, 'function');
    assert.strictEqual(typeof require('../src/telegram/commands/user/startHandler').registerStartHandler, 'function');
    assert.strictEqual(typeof require('../src/telegram/commands/user/supportFlow').createStartSupportFlow, 'function');
    assert.strictEqual(typeof require('../src/telegram/middlewares/textCatchAllHandler').registerTextCatchAllHandler, 'function');
    assert.strictEqual(typeof require('../src/telegram/middlewares/forwardSpamMiddleware').registerForwardSpamMiddleware, 'function');
    assert.strictEqual(typeof require('../src/telegram/middlewares/productMediaHandler').registerProductMediaHandler, 'function');
    assert.strictEqual(typeof require('../src/telegram/commands/admin/giveawayHelpers').createBuildGiveawaysPanel, 'function');
    const botSrc = fs.readFileSync(require.resolve('../src/bot.js'), 'utf8');
    assert.ok(!botSrc.includes("bot.on('text'"), 'text catch-all fora de bot.js');
    assert.ok(!botSrc.includes('async function buildGiveawaysPanel'), 'giveaway panel em helper');
    assert.ok(botSrc.includes('bootstrapHanorkBot'));
    const regBotSrc = fs.readFileSync(require.resolve('../src/bot/registerHanorkBot.js'), 'utf8');
    assert.ok(regBotSrc.includes('registerTextCatchAllHandler'));
});

test('B3 M5 — schedulers, shutdown, analytics, startBot, finalizeBot', () => {
    const reg = require('../src/jobs/registerAllSchedulers');
    assert.strictEqual(typeof reg.registerEarlySchedulers, 'function');
    assert.strictEqual(typeof reg.registerPostBootSchedulers, 'function');
    assert.strictEqual(typeof require('../src/app/gracefulShutdown').registerGracefulShutdown, 'function');
    assert.strictEqual(typeof require('../src/app/startBot').startBot, 'function');
    assert.strictEqual(typeof require('../src/bot/bootstrap/finalizeBot').finalizeBotBootstrap, 'function');
    assert.strictEqual(typeof require('../src/jobs/eventHandlers/orderPaidAnalytics').registerOrderPaidAnalytics, 'function');
    const botSrc = fs.readFileSync(require.resolve('../src/bot.js'), 'utf8');
    const bootSrc = fs.readFileSync(require.resolve('../src/bot/bootstrapHanorkBot.js'), 'utf8');
    const ctxSrc = fs.readFileSync(require.resolve('../src/bot/createBotContext.js'), 'utf8');
    assert.ok(botSrc.includes('finalizeBotBootstrap'));
    assert.ok(bootSrc.includes('createGroupBroadcastStack'));
    assert.ok(bootSrc.includes('createMainMenuHandlers'));
    assert.ok(!botSrc.includes('registerPaymentActions(bot'), 'payment legado via finalizeBot');
    assert.ok(!botSrc.includes('async function startBot'), 'startBot extraído para app/startBot.js');
    assert.ok(!botSrc.includes('startCartCleanupScheduler(prisma'), 'cart scheduler inline removido');
    assert.ok(!botSrc.includes('async function gracefulShutdown'), 'shutdown duplicado removido');
    assert.ok(!ctxSrc.includes('eventBus.on(DomainEvents.ORDER_PAID'), 'analytics extraído');
    const startBotLines = fs.readFileSync(require.resolve('../src/app/startBot.js'), 'utf8').split('\n').length;
    assert.ok(startBotLines < 400, 'startBot.js compacto');
    assert.ok(botSrc.split('\n').length < 50, 'bot.js compositor abaixo de 50 LOC');
    assert.strictEqual(typeof require('../src/bot/registerHanorkBot').registerHanorkBot, 'function');
    assert.strictEqual(typeof require('../src/bot/createBotContext').createBotContext, 'function');
    assert.strictEqual(typeof require('../src/bot/bootstrapHanorkBot').bootstrapHanorkBot, 'function');
    assert.strictEqual(typeof require('../src/bot/helpers/catalogHelpers').createCatalogHelpers, 'function');
    assert.strictEqual(typeof require('../src/bot/adapters/CartAdapter').createCartAdapter, 'function');
    assert.strictEqual(typeof require('../src/bot/helpers/affiliateBridge').createAffiliateBridge, 'function');
    assert.strictEqual(typeof require('../src/bot/helpers/productAdminBridge').createProductAdminBridge, 'function');
    assert.strictEqual(typeof require('../src/bot/helpers/checkoutBridge').createCheckoutBridge, 'function');
    assert.ok(ctxSrc.includes('createCatalogHelpers'));
    assert.ok(bootSrc.includes('createCheckoutBridge'));
    assert.ok(!ctxSrc.includes('class Cart {'), 'Cart adapter extraído');
    assert.ok(!ctxSrc.includes('async function loadProducts'), 'catalog helpers extraídos');
    assert.strictEqual(typeof require('../src/modules/security/CommandRateLimiter'), 'function');
    assert.strictEqual(typeof require('../src/bot/bootstrap/buildAdminDeps').buildAdminDeps, 'function');
    assert.strictEqual(typeof require('../src/services/hanork-ai/wireHanorkRouterNative').wireHanorkRouterNative, 'function');
});

console.log(failed ? `\n${failed} falha(s)\n` : '\nOK — M3/M4 modules\n');
process.exit(failed ? 1 : 0);
