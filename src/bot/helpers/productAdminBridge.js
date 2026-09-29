'use strict';

const { createBotSessionManager } = require('../../services/BotSessionService');
const ProductWizardService = require('../../services/ProductWizardService');
const ProductAdminService = require('../../services/ProductAdminService');
const { notifyRestock: notifyRestockFn } = require('../../telegram/commands/user/orderFeedbackHandlers');

function createProductAdminBridge(deps) {
    const {
        getBot,
        prisma,
        dbRaw,
        CONFIG,
        Msg,
        Markup,
        isAdmin,
        broadcastMode,
        giveawayMode,
        adminMsgTarget,
        addProductMode,
        joinChatAwaiting,
        campanhaEmailMode,
        supportMode,
        hanorkAssistMode,
        editProductMode,
        activeChats,
        invalidateProductCache,
        AuditService,
        UserService,
    } = deps;

    const productWizard = new Map();
    const catalogSearchMode = new Map();
    const onboardingStep = new Map();
    const resgateTentativas = new Map();

    const botSession = createBotSessionManager({
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
    });

    function sessionNote(text, cleared) {
        return botSession.appendDiscardedNote(text, cleared);
    }

    function productFlags(cleared) {
        if (!cleared) return null;
        if (cleared.productWizard != null || cleared.editProduct != null) return cleared;
        return { productWizard: cleared.wizard, editProduct: cleared.edit };
    }

    async function clearAllProductAdminSessions(ctxOrUid) {
        const ctx =
            typeof ctxOrUid === 'object' && ctxOrUid?.from
                ? ctxOrUid
                : { from: { id: ctxOrUid }, chat: { id: ctxOrUid } };
        const cleared = await botSession.clearAdminSessions(ctx);
        return { wizard: !!cleared.productWizard, edit: !!cleared.editProduct, _all: cleared };
    }

    async function beginProductFieldEdit(ctx, adminId, pid, field) {
        const p = await ProductAdminService.findProduct(pid, true);
        if (!p) return { ok: false, error: 'Produto não encontrado.' };

        const fakeCtx = ctx?.from ? ctx : { from: { id: adminId }, chat: { id: adminId } };
        const cleared = await botSession.enterAdminFlow(fakeCtx, 'editProduct');
        await editProductMode.set(adminId, { pid, field, _ts: Date.now() });
        return { ok: true, cleared, product: p };
    }

    async function beginProductCreateFlow(ctx, adminId) {
        const fakeCtx = ctx?.from ? ctx : { from: { id: adminId }, chat: { id: adminId } };
        const cleared = await botSession.enterAdminFlow(fakeCtx, 'productWizard');
        ProductWizardService.startWizard(productWizard, adminId);
        return cleared;
    }

    function wizardDeps() {
        return {
            prisma,
            invalidateProductCache,
            AuditService,
            UserService,
            photosDir: CONFIG.CAMINHO_FOTOS,
        };
    }

    function productAdminDeps(ctx) {
        return {
            ...wizardDeps(),
            productsDir: CONFIG.CAMINHO_PRODUTOS,
            adminTelegramId: ctx?.from?.id,
            notifyRestock: (productId, productName) =>
                notifyRestockFn({ bot: getBot(), prisma, Markup }, productId, productName),
        };
    }

    async function openProductAdminPanel(ctx, pid, { edit = false, sessionCleared = null } = {}) {
        const p = await ProductAdminService.findProduct(pid, true);
        if (!p) {
            const msg = '❌ Produto não encontrado.';
            if (edit && ctx.callbackQuery) {
                return Msg.editCallbackPanel(ctx, msg, Markup.inlineKeyboard([[{ text: '🔙 Produtos', callback_data: 'prod_menu_back' }]]));
            }
            return Msg.reply(ctx, msg);
        }
        const sales = await ProductAdminService.getSalesCount(pid, dbRaw);
        let text =
            ProductAdminService.buildProductDetailText(p, { sales }) +
            '\n\n<i>Toque nos botões abaixo ou use atalhos:</i>\n' +
            `<code>/editproduto ${pid} preco 29.90</code>`;
        text = sessionNote(text, sessionCleared);
        const kb = ProductAdminService.buildEditKeyboard(pid, p);
        if (edit && ctx.callbackQuery) return Msg.editCallbackPanel(ctx, text, kb);
        return Msg.reply(ctx, text, { parse_mode: 'HTML', reply_markup: kb.reply_markup });
    }

    async function openProductAdminPanelWithCleanSessions(ctx, pid, { edit = false } = {}) {
        const cleared = await botSession.clearForAdminNav(ctx);
        return openProductAdminPanel(ctx, pid, { edit, sessionCleared: cleared });
    }

    return {
        productWizard,
        catalogSearchMode,
        onboardingStep,
        resgateTentativas,
        botSession,
        sessionNote,
        productFlags,
        clearAllProductAdminSessions,
        beginProductFieldEdit,
        beginProductCreateFlow,
        openProductAdminPanelWithCleanSessions,
        wizardDeps,
        productAdminDeps,
        openProductAdminPanel,
    };
}

module.exports = { createProductAdminBridge };
