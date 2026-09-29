'use strict';

const { sendProgressPanel, updateAdminPanelMessage } = require('./shared');
const { createDestinationHelpers } = require('./destinationHelpers');
const { registerPanelHandlers } = require('./panelHandlers');
const { registerGroupsHandlers } = require('./groupsHandlers');
const { registerCrmHandlers } = require('./crmHandlers');
const { registerBroadcastHandlers } = require('./broadcastHandlers');
const { registerOrdersHandlers } = require('./ordersHandlers');
const { registerBridgeHandlers } = require('./bridgeHandlers');
const { registerSupportHandlers } = require('./supportHandlers');
const { registerUsersHandlers } = require('./usersHandlers');
const { registerAnalyticsHandlers } = require('./analyticsHandlers');

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
    registerUsersHandlers(bot, depsWithLists);
    registerAnalyticsHandlers(bot, depsWithLists);

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
