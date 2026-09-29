'use strict';

const MODE_LABELS = {
    broadcast: 'Modo broadcast',
    giveaway: 'Criação de sorteio',
    adminMsg: 'Mensagem direta ao usuário',
    joinChat: 'Vínculo de grupo/canal',
    addProduct: 'Cadastro de produto',
    productWizard: 'Cadastro de produto',
    editProduct: 'Edição de produto',
    campanhaEmail: 'Cadastro de e-mail',
    support: 'Modo suporte',
    catalogSearch: 'Busca no catálogo',
    onboarding: 'Tour inicial',
};

function mergeCleared(...parts) {
    const out = {};
    for (const p of parts) {
        if (!p) continue;
        for (const [k, v] of Object.entries(p)) {
            if (v) out[k] = true;
        }
    }
    return out;
}

function formatDiscardedNote(cleared) {
    if (!cleared || typeof cleared !== 'object') return '';
    const labels = Object.entries(cleared)
        .filter(([, v]) => v)
        .map(([k]) => MODE_LABELS[k] || k);
    if (!labels.length) return '';
    const uniq = [...new Set(labels)];
    if (uniq.length === 1) {
        return `\n\n<i>ℹ️ ${uniq[0]} pendente foi cancelado(a).</i>`;
    }
    return `\n\n<i>ℹ️ Fluxos pendentes cancelados: ${uniq.join(', ')}.</i>`;
}

function appendDiscardedNote(text, cleared) {
    const note = formatDiscardedNote(cleared);
    return note ? `${text}${note}` : text;
}

function createBotSessionManager(deps) {
    const {
        isAdmin,
        broadcastMode,
        giveawayMode,
        adminMsgTarget,
        addProductMode,
        joinChatAwaiting,
        campanhaEmailMode,
        supportMode,
        hanorkAssistMode,
        catalogSearchMode,
        onboardingStep,
        productWizard,
        editProductMode,
        activeChats,
        ProductWizardService,
    } = deps;

    async function isInLiveTicketChat(ctx) {
        if (!activeChats) return false;
        const chatId = ctx?.chat?.id;
        const uid = ctx?.from?.id;
        try {
            if (chatId != null) {
                const byChat = await activeChats.get(chatId);
                if (byChat?.ticketId) return true;
            }
            if (uid != null) {
                const byUser = await activeChats.get(uid);
                if (byUser?.ticketId) return true;
            }
        } catch {
            /* não bloquear navegação se Redis/state falhar */
        }
        return false;
    }

    async function safeRun(fn) {
        try {
            await fn();
            return true;
        } catch {
            return false;
        }
    }

    async function clearProductSessions(uid, { except = [] } = {}) {
        const cleared = {};
        if (uid == null) return cleared;
        const skip = new Set(except);

        if (!skip.has('productWizard') && productWizard?.has(uid)) {
            if (await safeRun(() => ProductWizardService.clearWizard(productWizard, uid))) {
                cleared.productWizard = true;
            }
        }
        if (!skip.has('editProduct') && editProductMode && (await editProductMode.has(uid))) {
            if (await safeRun(() => editProductMode.delete(uid))) {
                cleared.editProduct = true;
            }
        }
        return cleared;
    }

    async function clearAdminSessions(ctx, { except = [] } = {}) {
        const uid = ctx?.from?.id;
        const cleared = {};
        if (!uid || !isAdmin?.(uid)) return cleared;

        const skip = new Set(except);
        if (skip.has('product')) {
            skip.add('productWizard');
            skip.add('editProduct');
        }

        if (!skip.has('broadcast') && broadcastMode && (await broadcastMode.has(uid))) {
            if (await safeRun(() => broadcastMode.delete(uid))) cleared.broadcast = true;
        }
        if (!skip.has('giveaway') && giveawayMode && (await giveawayMode.has(uid))) {
            if (await safeRun(() => giveawayMode.delete(uid))) cleared.giveaway = true;
        }
        if (!skip.has('adminMsg') && adminMsgTarget && (await adminMsgTarget.has(uid))) {
            if (await safeRun(() => adminMsgTarget.delete(uid))) cleared.adminMsg = true;
        }
        if (!skip.has('joinChat') && joinChatAwaiting?.has(uid)) {
            if (await safeRun(() => joinChatAwaiting.delete(uid))) cleared.joinChat = true;
        }
        if (!skip.has('addProduct') && addProductMode && (await addProductMode.has(uid))) {
            if (await safeRun(() => addProductMode.delete(uid))) cleared.addProduct = true;
        }

        Object.assign(
            cleared,
            await clearProductSessions(uid, {
                except: [
                    ...(skip.has('productWizard') ? ['productWizard'] : []),
                    ...(skip.has('editProduct') ? ['editProduct'] : []),
                ],
            })
        );

        return cleared;
    }

    async function clearUserSessions(ctx, { except = [] } = {}) {
        const uid = ctx?.from?.id;
        const chatId = ctx?.chat?.id;
        const cleared = {};
        const skip = new Set(except);

        if (!skip.has('campanhaEmail') && uid && campanhaEmailMode && (await campanhaEmailMode.has(uid))) {
            if (await safeRun(() => campanhaEmailMode.delete(uid))) cleared.campanhaEmail = true;
        }
        if (!skip.has('hanork') && chatId && hanorkAssistMode && (await hanorkAssistMode.has(chatId))) {
            if (await safeRun(() => hanorkAssistMode.delete(chatId))) cleared.hanork = true;
        }
        if (!skip.has('support') && chatId && supportMode && (await supportMode.has(chatId))) {
            if (await safeRun(() => supportMode.delete(chatId))) cleared.support = true;
        }
        if (!skip.has('catalogSearch') && uid && catalogSearchMode?.has(uid)) {
            if (await safeRun(() => catalogSearchMode.delete(uid))) cleared.catalogSearch = true;
        }
        if (!skip.has('onboarding') && chatId && onboardingStep?.has(chatId)) {
            if (await safeRun(() => onboardingStep.delete(chatId))) cleared.onboarding = true;
        }
        return cleared;
    }

    /** Cancelamento explícito (/cancelar) — limpa modos pendentes, não mexe em ticket ao vivo */
    async function clearForCancel(ctx) {
        if (await isInLiveTicketChat(ctx)) {
            const admin = await clearAdminSessions(ctx);
            return admin;
        }
        const admin = await clearAdminSessions(ctx);
        const user = await clearUserSessions(ctx);
        return mergeCleared(admin, user);
    }

    /** Navegação admin (painel, produtos, broadcast…) — só modos admin */
    async function clearForAdminNav(ctx) {
        if (await isInLiveTicketChat(ctx)) return {};
        return clearAdminSessions(ctx);
    }

    /** Navegação usuário (menu, catálogo…) — só modos do comprador */
    async function clearForUserNav(ctx) {
        if (await isInLiveTicketChat(ctx)) return {};
        return clearUserSessions(ctx);
    }

    /** Compat — preferir clearForCancel / clearForAdminNav / clearForUserNav */
    async function clearAllSessions(ctx, options = {}) {
        if (await isInLiveTicketChat(ctx)) {
            return clearAdminSessions(ctx, options);
        }
        const admin = await clearAdminSessions(ctx, options);
        const user = await clearUserSessions(ctx, options);
        return mergeCleared(admin, user);
    }

    async function enterAdminFlow(ctx, flowKey, options = {}) {
        if (await isInLiveTicketChat(ctx)) return {};
        const alsoKeep = options.alsoKeep || [];
        const except = new Set([...alsoKeep]);

        if (flowKey === 'broadcast') except.add('broadcast');
        else if (flowKey === 'giveaway') except.add('giveaway');
        else if (flowKey === 'adminMsg') except.add('adminMsg');
        else if (flowKey === 'joinChat') except.add('joinChat');
        else if (flowKey === 'editProduct') except.add('editProduct');
        else if (flowKey === 'productWizard') except.add('productWizard');
        else if (flowKey === 'product') {
            except.add('productWizard');
            except.add('editProduct');
        }

        return clearAdminSessions(ctx, { except: [...except] });
    }

    async function enterUserFlow(ctx, flowKey, options = {}) {
        if (await isInLiveTicketChat(ctx)) return {};
        const alsoKeep = options.alsoKeep || [];
        const except = new Set([...alsoKeep]);

        if (flowKey === 'campanhaEmail') except.add('campanhaEmail');
        else if (flowKey === 'support') except.add('support');
        else if (flowKey === 'catalogSearch') except.add('catalogSearch');
        else if (flowKey === 'onboarding') except.add('onboarding');

        return clearUserSessions(ctx, { except: [...except] });
    }

    return {
        clearProductSessions,
        clearAdminSessions,
        clearUserSessions,
        clearAllSessions,
        clearForCancel,
        clearForAdminNav,
        clearForUserNav,
        enterAdminFlow,
        enterUserFlow,
        isInLiveTicketChat,
        formatDiscardedNote,
        appendDiscardedNote,
        mergeCleared,
    };
}

module.exports = {
    MODE_LABELS,
    mergeCleared,
    formatDiscardedNote,
    appendDiscardedNote,
    createBotSessionManager,
};
