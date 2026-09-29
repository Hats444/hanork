'use strict';

const MsgService = require('../../telegram/MsgService');
const { BroadcastService } = require('../../services/BroadcastService');
const { AutoBroadcastService } = require('../../services/AutoBroadcastService');
const { GroupSettingsService } = require('../../services/GroupSettingsService');
const { GroupService } = require('../../services/GroupService');

/**
 * B3 — serviços de grupo, broadcast, bridge e comandos /id após `const bot`.
 */
function createGroupBroadcastStack(deps) {
    const {
        bot,
        logger,
        lastMenuMsg,
        dbRaw,
        loadProducts,
        getMaintenanceMode,
        getBotUsername,
        adminActivityNotifier,
        isAdmin,
        CONFIG,
        Markup,
        Msg,
        commandLimiter,
        prisma,
        bannedUsers,
        broadcastMode,
        addProductMode,
        editProductMode,
        productWizard,
        adminMsgTarget,
        campanhaEmailMode,
        giveawayMode,
        supportMode,
        activeChats,
        cuponsAplicados,
        affSaldoAplicado,
        comprasPendentes,
        abandonedCartNotified,
        deliverySlotStore,
    } = deps;

    const { registerEarlySchedulers } = require('../../jobs/registerAllSchedulers');
    registerEarlySchedulers({
        commandLimiter,
        logger,
        prisma,
        bot,
        Markup,
        dbRaw,
        CONFIG,
        bannedUsers,
        broadcastMode,
        addProductMode,
        editProductMode,
        productWizard,
        adminMsgTarget,
        campanhaEmailMode,
        giveawayMode,
        supportMode,
        activeChats,
        cuponsAplicados,
        affSaldoAplicado,
        comprasPendentes,
        lastMenuMsg,
        abandonedCartNotified,
    });

    bot.catch((err, ctx) => {
        const msg = err?.message || String(err);
        if (msg.includes('Promise timed out')) {
            logger.warn(`[Bot] handler timeout uid=${ctx?.from?.id} chat=${ctx?.chat?.id}`);
            return;
        }
        logger.error(`[Bot] ${msg}`, { userId: ctx?.from?.id, updateType: ctx?.updateType });
    });

    MsgService.init(bot, { lastMenuMsg, dbRaw, slotStore: deliverySlotStore });
    const groupSettings = new GroupSettingsService(dbRaw);
    const groupService = new GroupService({ dbRaw, groupSettings, bot, adminActivityNotifier });

    const { createGroupHelpers } = require('../../telegram/events/groupEvents');
    const { upsertGroup, upsertGroupMember } = createGroupHelpers({ dbRaw, logger, groupService });

    const broadcastService = new BroadcastService({
        bot,
        lastMenuMsg,
        dbRaw,
        groupService,
        groupSettings,
    });
    const executeBroadcast = (texto, parseMode, replyMarkup) =>
        broadcastService.executeBroadcast(texto, parseMode, replyMarkup);

    const {
        AUTO_BROADCAST_INTERVAL_MS,
        AUTO_BROADCAST_EFFECTIVE_INTERVAL_MS,
        AUTO_BROADCAST_DELAYS,
        formatBroadcastInterval,
        resolvePvCycleGuardMs,
    } = require('../../config/broadcastConfig');

    const autoBroadcastService = new AutoBroadcastService({
        dbRaw,
        broadcastService,
        loadProducts,
        getMaintenanceMode,
        getBotUsername,
        prisma,
        photosDir: CONFIG.CAMINHO_FOTOS,
        intervalMs: AUTO_BROADCAST_EFFECTIVE_INTERVAL_MS,
        pvCycleGuardMs: resolvePvCycleGuardMs(),
        ...AUTO_BROADCAST_DELAYS,
    });

    const { getBridgeBroadcastService } = require('../../services/BridgeBroadcastService');
    getBridgeBroadcastService({
        dbRaw,
        groupService,
        getBotUsername,
        groupDelayMs: AUTO_BROADCAST_DELAYS.groupDelayMs,
    });

    const { getBridgePoolService } = require('../../services/BridgePoolService');
    const bridgePoolService = getBridgePoolService({
        dbRaw,
        groupService,
        telegram: bot.telegram,
        getBotUsername,
        adminActivityNotifier,
    });

    const executeFullBroadcast = (texto, parseMode, replyMarkup, options) =>
        broadcastService.executeFullBroadcast(texto, parseMode, replyMarkup, options);

    function getVipGroupId() {
        return groupSettings.getVipGroupId();
    }

    function getSupportGroupId() {
        return groupSettings.getSupportGroupId();
    }

    function syncBusinessLinksFromSettings() {
        const { getSalesRefChannelUrl } = require('../../config/salesReferenceChannel');
        const link = getSalesRefChannelUrl();
        const contact = groupSettings.getContactUrl();
        const grupoId = groupSettings.getVipGroupId();
        CONFIG.LINKGP = link;
        CONFIG.CONTATO_ESPECIALISTA = contact;
        if (grupoId != null) CONFIG.GRUPO_ID = grupoId;
        process.env.LINKGP = link;
        try {
            const { syncRuntimeLinks } = require('../../config/config');
            syncRuntimeLinks({ linkGp: link, contact, grupoId });
        } catch {
            /* ignore */
        }
    }
    syncBusinessLinksFromSettings();

    const downloadsGuard = require('../../telegram/downloadsGuard');
    const referenceChannelGuard = require('../../telegram/referenceChannelGuard');
    downloadsGuard.configure({ groupSettings, isAdmin, bot });
    referenceChannelGuard.configure({ bot, isAdmin });
    const channelId = require('../../config/salesReferenceChannel').getSalesRefChannelId();
    if (channelId) {
        logger.info('[Downloads] canal referências obrigatório', {
            channelId,
            link: require('../../config/salesReferenceChannel').getSalesRefChannelUrl(),
            dailyLimit: downloadsGuard.getDailyLimit(),
        });
    }

    const { registerIdCommands } = require('../../telegram/commands/idCommands');
    registerIdCommands(bot, {
        isAdmin,
        Msg,
        groupSettings,
        groupService,
        CONFIG,
        syncBusinessLinks: syncBusinessLinksFromSettings,
        getBotUsername,
        logger,
    });

    return {
        groupSettings,
        groupService,
        broadcastService,
        autoBroadcastService,
        bridgePoolService,
        upsertGroup,
        upsertGroupMember,
        executeBroadcast,
        executeFullBroadcast,
        getVipGroupId,
        getSupportGroupId,
        syncBusinessLinksFromSettings,
        downloadsGuard,
        formatBroadcastInterval,
        AUTO_BROADCAST_INTERVAL_MS,
        AUTO_BROADCAST_EFFECTIVE_INTERVAL_MS,
    };
}

module.exports = { createGroupBroadcastStack };
