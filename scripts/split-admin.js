'use strict';

const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '../src/telegram/commands/admin.js');
const outDir = path.join(__dirname, '../src/telegram/commands/admin');
const lines = fs.readFileSync(src, 'utf8').split(/\n/);

const sharedEnd = lines.findIndex((l) => l.includes('* Uso: registerAdminHandlers'));
const fnStart = lines.findIndex((l) => l.startsWith('function registerAdminHandlers'));
const destructureEnd = lines.findIndex((l, i) => i > fnStart && l.trim() === '} = deps;');

const destructureBlock = lines.slice(fnStart + 1, destructureEnd + 1).join('\n');

const chunks = [
    { name: 'panelHandlers', start: 190, end: 531, title: 'Painel admin, stats, produtos, manutenção' },
    { name: 'destinationHelpers', start: 532, end: 609, title: 'Helpers listagem destinos/grupos/canais', exportHelpers: true },
    { name: 'groupsHandlers', start: 610, end: 738, title: 'Destinos, grupos, canais, ponte' },
    { name: 'crmHandlers', start: 740, end: 911, title: 'Tickets, cupons, afiliados' },
    { name: 'broadcastHandlers', start: 913, end: 1249, title: 'Broadcast admin' },
    { name: 'ordersHandlers', start: 1252, end: 1567, title: 'Pedidos, financeiro, flash, export' },
    { name: 'bridgeHandlers', start: 1569, end: 1747, title: 'conectar, ponte, entrar' },
    { name: 'supportHandlers', start: 1749, end: 2005, title: 'Reviews, tickets chat, sorteios' },
];

fs.mkdirSync(outDir, { recursive: true });

const sharedLines = lines.slice(0, sharedEnd).join('\n');
fs.writeFileSync(
    path.join(outDir, 'shared.js'),
    sharedLines.replace(
        "const { BroadcastService } = require('../../services/BroadcastService');",
        "'use strict';\n\nconst { BroadcastService } = require('../../services/BroadcastService');"
    ) +
        '\n\nmodule.exports = {\n' +
        '    sendProgressPanel,\n' +
        '    updateAdminPanelMessage,\n' +
        '    entrarNeedsBridge,\n' +
        '    fullDivulgacaoDeps,\n' +
        '    startFullDivulgacaoBackground,\n' +
        '    replyEntrarBatch,\n' +
        '};\n'
);

fs.writeFileSync(
    path.join(outDir, 'deps.js'),
    `'use strict';

/** Destructuring compartilhado — M4 admin split */
function pickAdminDeps(deps) {
${destructureBlock.replace('const {', '    const {').replace('} = deps;', '    } = deps;')}
    return { ...deps, prisma, dbRaw, Markup, isAdmin, ADMIN_HTML, Msg, Menu, logger,
        antiSpam, backup, broadcastMode, addProductMode, adminMsgTarget,
        editProductMode, giveawayMode, getMaintenanceMode, setMaintenanceMode,
        botSession, appendSessionDiscardedNote, getAutoBroadcastEnabled, setAutoBroadcastEnabled,
        getAutoBroadcastLastSent, getAutoBroadcastCount, AUTO_BROADCAST_INTERVAL, formatBroadcastInterval,
        getAutoBroadcastLastSummary, runAutoBroadcastNow, runBridgePromoNow, runBridgePromoAfterBot,
        emailService, loadProducts, executeBroadcast, executeFullBroadcast, broadcastService,
        sendAdminPanelWithPhoto, editAdminPanel, invalidateProductCache, invalidateBotUsername, formatTimer,
        carrinhos, UserService, AuditService, sendMainMenu, deliverProducts, confirmarSaldoReservado,
        showUsers, activeChats, openTicketChat, closeTicketChat, ticketCloseKeyboard,
        buildGiveawaysPanel, groupSettings, groupService, joinChatAwaiting,
    };
}

module.exports = { pickAdminDeps };
`
);

const commonRequires = `'use strict';

const { kb2, normalizeReplyMarkup } = require('../../menus/twoColKeyboard');
const destinationsPanel = require('../../admin/broadcastDestinations');
const {
    entrarNeedsBridge,
    fullDivulgacaoDeps,
    startFullDivulgacaoBackground,
    sendProgressPanel,
    updateAdminPanelMessage,
} = require('./shared');
const { pickAdminDeps } = require('./deps');
`;

for (const chunk of chunks) {
    const body = lines.slice(chunk.start - 1, chunk.end).join('\n');
    const exportName = `register${chunk.name.charAt(0).toUpperCase() + chunk.name.slice(1)}`;

    let content;
    if (chunk.exportHelpers) {
        content = `${commonRequires}

/** ${chunk.title} */
function createDestinationHelpers(deps) {
    const {
        prisma, dbRaw, Markup, isAdmin, ADMIN_HTML, Msg, logger, groupService, editAdminPanel,
    } = pickAdminDeps(deps);

${body}

    return { showDestinationsHub, showGroupsList, showBridgeGroupsList, showChannelsList };
}

module.exports = { createDestinationHelpers };
`;
    } else {
        content = `${commonRequires}

/** ${chunk.title} — M4 */
function ${exportName}(bot, deps) {
    const d = pickAdminDeps(deps);
    const {
        prisma, dbRaw, Markup, isAdmin, ADMIN_HTML, Msg, Menu, logger,
        antiSpam, backup, broadcastMode, addProductMode, adminMsgTarget,
        editProductMode, giveawayMode, getMaintenanceMode, setMaintenanceMode,
        botSession, appendSessionDiscardedNote, getAutoBroadcastEnabled, setAutoBroadcastEnabled,
        getAutoBroadcastLastSent, getAutoBroadcastCount, AUTO_BROADCAST_INTERVAL, formatBroadcastInterval,
        getAutoBroadcastLastSummary, runAutoBroadcastNow, runBridgePromoNow, runBridgePromoAfterBot,
        emailService, loadProducts, executeBroadcast, executeFullBroadcast, broadcastService,
        sendAdminPanelWithPhoto, editAdminPanel, invalidateProductCache, invalidateBotUsername, formatTimer,
        carrinhos, UserService, AuditService, sendMainMenu, deliverProducts, confirmarSaldoReservado,
        showUsers, activeChats, openTicketChat, closeTicketChat, ticketCloseKeyboard,
        buildGiveawaysPanel, groupSettings, groupService, joinChatAwaiting,
    } = d;

${body}
}

module.exports = { ${exportName} };
`;
    }
    fs.writeFileSync(path.join(outDir, `${chunk.name}.js`), content);
}

fs.writeFileSync(
    path.join(outDir, 'index.js'),
    `'use strict';

const { sendProgressPanel, updateAdminPanelMessage } = require('./shared');
const { createDestinationHelpers } = require('./destinationHelpers');
const { registerPanelHandlers } = require('./panelHandlers');
const { registerGroupsHandlers } = require('./groupsHandlers');
const { registerCrmHandlers } = require('./crmHandlers');
const { registerBroadcastHandlers } = require('./broadcastHandlers');
const { registerOrdersHandlers } = require('./ordersHandlers');
const { registerBridgeHandlers } = require('./bridgeHandlers');
const { registerSupportHandlers } = require('./supportHandlers');

function registerAdminHandlers(bot, deps) {
    const listPanels = createDestinationHelpers(deps);
    const depsWithLists = {
        ...deps,
        showDestinationsHub: listPanels.showDestinationsHub,
        showGroupsList: listPanels.showGroupsList,
        showBridgeGroupsList: listPanels.showBridgeGroupsList,
        showChannelsList: listPanels.showChannelsList,
    };

    registerPanelHandlers(bot, depsWithLists);
    registerGroupsHandlers(bot, depsWithLists);
    registerCrmHandlers(bot, depsWithLists);
    registerBroadcastHandlers(bot, depsWithLists);
    registerOrdersHandlers(bot, depsWithLists);
    registerBridgeHandlers(bot, depsWithLists);
    registerSupportHandlers(bot, depsWithLists);

    if (deps.groupSettings && deps.groupService) {
        const { registerGroupHandlers } = require('../groups');
        registerGroupHandlers(bot, {
            isAdmin: deps.isAdmin,
            Msg: deps.Msg,
            ADMIN_HTML: deps.ADMIN_HTML,
            dbRaw: deps.dbRaw,
            groupSettings: deps.groupSettings,
            groupService: deps.groupService,
            editAdminPanel: deps.editAdminPanel,
            showGroupsList: listPanels.showGroupsList,
            showBridgeGroupsList: listPanels.showBridgeGroupsList,
            showChannelsList: listPanels.showChannelsList,
            showDestinationsHub: listPanels.showDestinationsHub,
            CONFIG: deps.CONFIG,
            syncBusinessLinks: deps.syncBusinessLinks,
        });
    }
}

module.exports = { registerAdminHandlers, sendProgressPanel, updateAdminPanelMessage };
`
);

fs.writeFileSync(
    path.join(__dirname, '../src/telegram/commands/admin.js'),
    `'use strict';

/** M4 — facade; implementação em ./admin/ */
module.exports = require('./admin/index');
`
);

console.log('Split admin.js into', outDir);
