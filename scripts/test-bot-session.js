'use strict';

const assert = require('assert');
const { createBotSessionManager } = require('../src/services/BotSessionService');
const ProductWizardService = require('../src/services/ProductWizardService');

const productWizard = new Map();
const joinChatAwaiting = new Set();
const catalogSearchMode = new Map();
const onboardingStep = new Map();

const activeChats = {
    get: async (id) => (id === 99 ? { ticketId: 7, role: 'user' } : null),
};

const botSession = createBotSessionManager({
    isAdmin: (uid) => uid === 1,
    broadcastMode: { has: async (uid) => uid === 1, delete: async () => {} },
    giveawayMode: { has: async () => false, delete: async () => {} },
    adminMsgTarget: { has: async () => false, delete: async () => {} },
    addProductMode: { has: async () => false, delete: async () => {} },
    joinChatAwaiting,
    campanhaEmailMode: {
        has: async (uid) => uid === 2,
        delete: async () => {},
    },
    supportMode: { has: async () => false, delete: async () => {} },
    catalogSearchMode,
    onboardingStep,
    productWizard,
    editProductMode: { has: async () => false, delete: async () => {}, set: async () => {} },
    activeChats,
    ProductWizardService,
});

(async () => {
    assert.strictEqual(await botSession.isInLiveTicketChat({ chat: { id: 99 }, from: { id: 2 } }), true);

    const navDuringTicket = await botSession.clearForUserNav({ chat: { id: 99 }, from: { id: 2 } });
    assert.deepStrictEqual(navDuringTicket, {});

    ProductWizardService.startWizard(productWizard, 1);
    const adminNav = await botSession.clearForAdminNav({ from: { id: 1 }, chat: { id: 1 } });
    assert.ok(adminNav.productWizard);

    const userNav = await botSession.clearForUserNav({ from: { id: 2 }, chat: { id: 50 } });
    assert.ok(userNav.campanhaEmail);

    console.log('test-bot-session: OK');
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
