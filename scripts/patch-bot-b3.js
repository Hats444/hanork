#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

const botPath = path.join(__dirname, '../src/bot.js');
let src = fs.readFileSync(botPath, 'utf8');

function removeBetween(startMarker, endMarker) {
    const i0 = src.indexOf(startMarker);
    const i1 = src.indexOf(endMarker, i0 >= 0 ? i0 : 0);
    if (i0 < 0 || i1 < 0) {
        console.error('Marker not found:', { start: startMarker.slice(0, 50), end: endMarker.slice(0, 50) });
        process.exit(1);
    }
    src = src.slice(0, i0) + src.slice(i1);
}

removeBetween(
    '// =============================================================================\n// 👥 GRUPOS — rastrear grupos, membros, boas-vindas VIP',
    'function wireHanorkRouterNative'
);

const wiring = `
const { registerForwardSpamMiddleware } = require('./telegram/middlewares/forwardSpamMiddleware');
registerForwardSpamMiddleware(bot, { Msg, isAdmin, productWizard, ProductWizardService });

const { registerProductMediaHandler } = require('./telegram/middlewares/productMediaHandler');
registerProductMediaHandler(bot, {
    isAdmin, editProductMode, ProductWizardService, ProductAdminService,
    buildProductPhotoFileName, productAdminDeps, wizardDeps, productWizard,
    CONFIG, Msg, Markup, logger, activeChats, prisma, bot,
});

registerGroupEvents(bot, {
    CONFIG, logger, dbRaw, Markup, loadProducts, getVipGroupId, bot,
    upsertGroup, upsertGroupMember,
});

const { registerTextCatchAllHandler } = require('./telegram/middlewares/textCatchAllHandler');
registerTextCatchAllHandler(bot, {
    Msg, Markup, Menu, logger, prisma, dbRaw, isAdmin, deferBackground,
    productWizard, ProductWizardService, editProductMode, ProductAdminService,
    productAdminDeps, wizardDeps, activeChats,
    joinChatAwaiting, groupService, bridgePoolService, broadcastMode,
    campanhaEmailMode, catalogSearchMode, supportMode, hanorkAssistMode,
    hanorkAssistantApi, adminMsgTarget, UserEmailService, loadProducts,
    sendProductWithPhoto, openUserCatalog, downloadsGuard, hanorkRouterNative,
    isGroupChat,
    isOnboarding: (uid) => {
        const { isOnboarding: fn } = require('./modules/tenant/onboardingHandler');
        return fn(uid);
    },
    CONFIG, ADMIN_HTML, broadcastService, autoBroadcastService, executeFullBroadcast,
    getVipGroupId, getSupportGroupId, escapeMd, ticketCloseKeyboard,
    stateManager, correlationContext, tenantContext, getBotUsername,
});

`;

removeBetween(
    '// PROTEÇÃO: FORWARD SPAM + MENSAGENS VAZIAS',
    '// suporte_start / suporte_btn → supportCommands.js'
);

const anchor = 'wireHanorkRouterNative(hanorkRouterNative);\n\n';
const idx = src.indexOf(anchor);
if (idx < 0) {
    console.error('wireHanork anchor missing');
    process.exit(1);
}
src = src.slice(0, idx + anchor.length) + wiring + src.slice(idx + anchor.length);

if (src.includes('async function buildGiveawaysPanel()')) {
    removeBetween(
        '\n/** Painel de sorteios no admin */\nasync function buildGiveawaysPanel()',
        '// BOOTSTRAP — sistema centralizado de callbacks'
    );
}

if (src.includes("bot.on('new_chat_members'")) {
    removeBetween(
        '\n// Quando novos membros entram (incluindo o bot)\nbot.on(\'new_chat_members\'',
        '// LEGACY PRODUCT & PAYMENT HANDLERS'
    );
}

fs.writeFileSync(botPath, src);
console.log('bot.js patched OK');
