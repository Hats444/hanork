#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const botPath = path.join(__dirname, '../src/bot.js');
const lines = fs.readFileSync(botPath, 'utf8').split('\n');
const body = lines.slice(2669, 3314).join('\n');
const tryBypass = lines.slice(2592, 2667).join('\n');
const outDir = path.join(__dirname, '../src/telegram/middlewares');
fs.mkdirSync(outDir, { recursive: true });
const depsList = `
    bot, Msg, Markup, Menu, logger, prisma, dbRaw, isAdmin, deferBackground,
    productWizard, ProductWizardService, editProductMode, ProductAdminService,
    buildProductPhotoFileName, productAdminDeps, wizardDeps, activeChats,
    joinChatAwaiting, groupService, bridgePoolService, broadcastMode,
    campanhaEmailMode, catalogSearchMode, supportMode, hanorkAssistMode,
    hanorkAssistantApi, botSession, sessionNote, onboardingStep, giveawayMode,
    adminMsgTarget, UserEmailService, loadProducts, sendProductWithPhoto,
    openUserCatalog, showCart, downloadsGuard, hanorkRouterNative, groupGuard,
    isGroupChat, handleOnboardingMessage, isOnboarding, CONFIG,
    startSupportFlow, antiSpam, createOrder, cartKey, Cart, cuponsAplicados,
    replyWithMenuPhoto, sendMainMenu, getProductById, startBuyProduct,
    AffiliateCore, processAffiliateRef, scheduleNewMemberAlerts,
`.trim();

const content = `'use strict';

/**
 * B3 — catch-all de texto (move-only de bot.js).
 */
function registerTextCatchAllHandler(bot, deps) {
    const {
        bot: telegramBot,
        Msg, Markup, Menu, logger, prisma, dbRaw, isAdmin, deferBackground,
        productWizard, ProductWizardService, editProductMode, ProductAdminService,
        buildProductPhotoFileName, productAdminDeps, wizardDeps, activeChats,
        joinChatAwaiting, groupService, bridgePoolService, broadcastMode,
        campanhaEmailMode, catalogSearchMode, supportMode, hanorkAssistMode,
        hanorkAssistantApi, botSession, sessionNote, onboardingStep, giveawayMode,
        adminMsgTarget, UserEmailService, loadProducts, sendProductWithPhoto,
        openUserCatalog, showCart, downloadsGuard, hanorkRouterNative, groupGuard,
        isGroupChat, handleOnboardingMessage, isOnboarding,
        startSupportFlow, antiSpam,
    } = deps;

${tryBypass.replace(/^async function tryHanorkShopBypass/, '    async function tryHanorkShopBypass')}

    bot.on('text', async (ctx, next) => {
${body.split('\n').map((l) => '        ' + l).join('\n')}
    });
}

module.exports = { registerTextCatchAllHandler };
`;

fs.writeFileSync(path.join(outDir, 'textCatchAllHandler.js'), content);
console.log('Wrote textCatchAllHandler.js', body.split('\n').length, 'lines');
