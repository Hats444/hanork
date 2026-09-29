'use strict';

const { getDeliverySlotStore } = require('../../services/DeliverySlotStore');

/**
 * B3 — facades Redis/SQLite para estado de sessão (compat Map API).
 */
function createBotStateFacades({ State, dbRaw, Markup, prisma, CONFIG }) {
    const comprasPendentes = {
        get: async (key) => await State.getPendingPurchase(key),
        set: async (key, value) => await State.setPendingPurchase(key, value),
        delete: async (key) => await State.deletePendingPurchase(key),
        has: async (key) => !!(await State.getPendingPurchase(key)),
        get size() { return (async () => (await State.keysInNamespace('pending_purchase')).length)(); },
        entries: async () => {
            const keys = await State.keysInNamespace('pending_purchase');
            const entries = [];
            for (const k of keys) {
                const v = await State.getPendingPurchase(k);
                if (v) entries.push([k, v]);
            }
            return entries;
        },
    };

    const cuponsAplicados = {
        get: async (key) => await State.getAppliedCoupon(key),
        set: async (key, value) => await State.setAppliedCoupon(key, value),
        delete: async (key) => await State.deleteAppliedCoupon(key),
        has: async (key) => !!(await State.getAppliedCoupon(key)),
        get size() { return (async () => (await State.keysInNamespace('applied_coupon')).length)(); },
    };

    const affSaldoAplicado = {
        get: async (key) => await State.getAffSaldoApplied(key),
        set: async (key, value) => await State.setAffSaldoApplied(key, value),
        delete: async (key) => await State.deleteAffSaldoApplied(key),
        has: async (key) => !!(await State.getAffSaldoApplied(key)),
    };

    const campanhaEmailMode = {
        get: async (key) => await State.getEmailMode(key),
        set: async (key, value) => await State.setEmailMode(key, value),
        delete: async (key) => await State.deleteEmailMode(key),
        has: async (key) => !!(await State.getEmailMode(key)),
    };

    const giveawayMode = {
        get: async (key) => await State.getGiveawayMode(key),
        set: async (key, value) => await State.setGiveawayMode(key, value),
        delete: async (key) => await State.deleteGiveawayMode(key),
        has: async (key) => !!(await State.getGiveawayMode(key)),
    };

    const supportMode = {
        get: async (key) => await State.getSupportMode(key),
        set: async (key, value) => await State.setSupportMode(key, value),
        delete: async (key) => await State.deleteSupportMode(key),
        has: async (key) => !!(await State.getSupportMode(key)),
    };

    const hanorkAssistMode = {
        get: async (key) => await State.getHanorkAssistMode(key),
        set: async (key, value) => await State.setHanorkAssistMode(key, value),
        delete: async (key) => await State.deleteHanorkAssistMode(key),
        has: async (key) => !!(await State.getHanorkAssistMode(key)),
    };

    const hanorkRouterContext = {
        get: async (key) => await State.getHanorkRouterContext(key),
        set: async (key, value, ttl) => await State.setHanorkRouterContext(key, value, ttl),
        delete: async (key) => await State.deleteHanorkRouterContext(key),
    };

    const activeChats = {
        get: async (key) => await State.getActiveChat(key),
        set: async (key, value) => await State.setActiveChat(key, value),
        delete: async (key) => await State.deleteActiveChat(key),
        has: async (key) => !!(await State.getActiveChat(key)),
    };

    function ticketCloseKeyboard(ticketId, forAdmin = false) {
        const rows = [[{ text: '🔴 Encerrar Ticket', callback_data: `tclose_${ticketId}` }]];
        if (forAdmin) {
            rows.push([{ text: '🔙 Tickets', callback_data: 'a_tickets' }]);
        } else {
            rows.push([{ text: '🏠 Menu', callback_data: 'menu:home' }]);
        }
        return Markup.inlineKeyboard(rows);
    }

    async function openTicketChat(ctx, ticketId, userChatId, adminChatId) {
        const adminId = adminChatId || ctx.from?.id;
        if (!adminId || !userChatId) return;

        const prevAdmin = await activeChats.get(adminId);
        if (prevAdmin && prevAdmin.ticketId !== ticketId) {
            await activeChats.delete(adminId);
        }

        await activeChats.set(adminId, {
            ticketId,
            role: 'admin',
            otherChatId: userChatId,
            _ts: Date.now(),
        });
        await activeChats.set(userChatId, {
            ticketId,
            role: 'user',
            otherChatId: adminId,
            _ts: Date.now(),
        });
    }

    async function closeTicketChat(ticketId, closedByChatId, closedByName = 'Sistema') {
        const t = await prisma.ticket.findById(ticketId);
        if (!t) return;

        if (t.status !== 'closed') {
            prisma.ticket.close(ticketId);
            prisma.ticket.addMessage(ticketId, 'system', `Encerrado por ${closedByName}`);
        }

        const userChatId = parseInt(t.telegram_id, 10);
        const ids = new Set([userChatId, parseInt(closedByChatId, 10), ...CONFIG.ID_DONO]);

        for (const chatId of ids) {
            if (!chatId) continue;
            const sess = await activeChats.get(chatId);
            if (sess?.ticketId === ticketId) {
                await activeChats.delete(chatId);
            }
        }
    }

    const deliverySlotStore = getDeliverySlotStore(dbRaw);
    const lastMenuMsg = {
        get: async (key) => {
            const persisted = await deliverySlotStore.get(key);
            if (persisted) return persisted;
            return State.getLastMenuMsg(key);
        },
        set: async (key, value) => {
            if (value?.messageId) {
                await deliverySlotStore.save(key, {
                    ...value,
                    menuType: value.menuType || 'menu',
                });
            }
            await State.setLastMenuMsg(key, value, 86400 * 30);
        },
        delete: async (key) => {
            await deliverySlotStore.delete(key);
            await State.deleteLastMenuMsg(key);
        },
        has: async (key) => !!(await deliverySlotStore.get(key) || (await State.getLastMenuMsg(key))),
    };

    const carrinhos = {
        get: async (key) => await State.getCart(key),
        set: async (key, value) => await State.setCart(key, value),
        delete: async (key) => await State.deleteCart(key),
        has: async (key) => await State.hasCart(key),
        size: async (key) => { const items = await State.getCart(key); return items ? items.length : 0; },
    };

    const abandonedCartNotified = {
        has: async (key) => await State.isCartAbandonedNotified(key),
        add: async (key) => await State.setCartAbandonedNotified(key),
        delete: async (key) => { /* TTL expira */ },
    };

    const broadcastMode = {
        get: async (key) => await State.getBroadcastMode(key),
        set: async (key, value) => await State.setBroadcastMode(key, value),
        delete: async (key) => await State.deleteBroadcastMode(key),
        has: async (key) => !!(await State.getBroadcastMode(key)),
    };

    const joinChatAwaiting = new Set();

    const addProductMode = {
        get: async (key) => await State.getAddProductMode(key),
        set: async (key, value) => await State.setAddProductMode(key, value),
        delete: async (key) => await State.deleteAddProductMode(key),
        has: async (key) => !!(await State.getAddProductMode(key)),
    };

    const editProductMode = {
        get: async (key) => await State.getEditProductMode(key),
        set: async (key, value) => await State.setEditProductMode(key, value),
        delete: async (key) => await State.deleteEditProductMode(key),
        has: async (key) => !!(await State.getEditProductMode(key)),
    };

    const adminMsgTarget = {
        get: async (key) => await State.getAdminMsgTarget(key),
        set: async (key, value) => await State.setAdminMsgTarget(key, value),
        delete: async (key) => await State.deleteAdminMsgTarget(key),
        has: async (key) => !!(await State.getAdminMsgTarget(key)),
    };

    return {
        comprasPendentes,
        cuponsAplicados,
        affSaldoAplicado,
        campanhaEmailMode,
        giveawayMode,
        supportMode,
        hanorkAssistMode,
        hanorkRouterContext,
        activeChats,
        ticketCloseKeyboard,
        openTicketChat,
        closeTicketChat,
        deliverySlotStore,
        lastMenuMsg,
        carrinhos,
        abandonedCartNotified,
        broadcastMode,
        joinChatAwaiting,
        addProductMode,
        editProductMode,
        adminMsgTarget,
    };
}

module.exports = { createBotStateFacades };
