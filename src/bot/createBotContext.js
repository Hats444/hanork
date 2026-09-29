const { resolveZerotwoApiBase } = require('../config/zerotwoEndpoints');

const path = require('path');
const { Markup } = require('telegraf');
const { patchTelegrafMarkup } = require('../telegram/menus/twoColKeyboard');
patchTelegrafMarkup(Markup);

const Msg = require('../telegram/Msg');
const groupGuard = require('../telegram/groupGuard');
const {
    isShopAreaStartPayload,
    resolveShopStartPayload,
} = require('../telegram/botInviteCopy');
const emailService = require('../config/email-service');
const UserEmailService = require('../services/UserEmailService');
const ProductWizardService = require('../services/ProductWizardService');
const ProductAdminService = require('../services/ProductAdminService');
const { buildProductPhotoFileName } = require('../utils/telegramMedia');
const { prisma, backup, migrateFromJSON, state } = require('../config/database');
const logger = require('../config/logger');
const { installAxiosLogging } = require('../utils/setupAxios');
installAxiosLogging(logger);
const monitor = require('../monitor');
const dbRaw = require('../config/database-sqlite').connect;
require('../services/TelegramUserBridge').setDbRaw(dbRaw);
const BackupManager = require('../config/BackupManager');
const { getStateManager } = require('../modules/state');
const State = getStateManager();
const { createAdminActivityNotifier } = require('../telegram/admin/AdminActivityNotifier');
const { eventBus, stateManager } = require('../infrastructure');
const { registry } = require('../core');
const { createMenuKeyboards } = require('../telegram/menus/MenuKeyboards');
const botInstanceLock = require('../modules/security/botInstanceLock');
const AntiSpamService = require('../modules/security/AntiSpamService');
const CommandRateLimiter = require('../modules/security/CommandRateLimiter');
const CouponAttemptLimiter = require('../modules/security/couponAttemptLimiter');
const { createBotStateFacades } = require('./state/createBotStateFacades');
const { getMenuPhotoInput, warmMenuPhotoCache } = require('../telegram/menuPhoto');
const PaymentService = require('../modules/payment/PaymentService');
const UserService = require('../modules/user/UserService');
const AuditService = require('../modules/audit/AuditService');
const QueueService = require('../modules/queue/QueueService');
const SafeWebhookHandler = require('../modules/payment/SafeWebhookHandler');
const SafeDeliveryService = require('../modules/delivery/SafeDeliveryService');
const { createCatalogHelpers } = require('./helpers/catalogHelpers');
const { createCartAdapter } = require('./adapters/CartAdapter');
const { createProductAdminBridge } = require('./helpers/productAdminBridge');
const { mpAmountMatchesOrder } = require('../modules/payment/paymentCheckUtils');
const webhookPaymentDedup = require('../modules/payment/webhookPaymentDedup');
const CustomerSubscriptionService = require('../modules/subscription/CustomerSubscriptionService');
const UserAccountCore = require('../modules/user/UserAccountCore');
const UserAccountPanels = require('../modules/user/UserAccountPanels');
const { deferBackground } = require('../utils/defer');
const {
    ADMIN_HTML,
    sendAdminPanelWithPhoto,
    editAdminPanel,
} = require('../telegram/admin/adminPanelUi');
const { deliverProducts: deliverProductsFn } = require('./helpers/deliverProducts');
const { getZerotwoApiKey } = require('../config/zerotwoEnv');

const CONFIG = {
    TOKEN_TELEGRAM: process.env.TOKEN_TELEGRAM,
    TOKEN_MP: process.env.TOKEN_MP,
    ID_DONO: (process.env.ID_DONO || '').split(',').map((id) => parseInt(id.trim(), 10)).filter(Boolean),
    SITE_HANORK: process.env.SITE_HANORK || 'https://hanork.com',
    LINKGP:
        process.env.LINKGP ||
        process.env.SALES_REF_CHANNEL_LINK ||
        (() => {
            try {
                return require('../config/salesReferenceChannel').getSalesRefChannelUrl();
            } catch {
                return 'https://t.me/hanorkinfos';
            }
        })(),
    CONTATO_ESPECIALISTA: process.env.CONTATO_ESPECIALISTA || 'https://t.me/hanorkoff',
    MIND7: process.env.MIND7 || 'https://mind-7.org',
    WORK: process.env.WORK || 'https://app.workconsultoria.com',
    API_KEY_ZEROTWO: getZerotwoApiKey(),
    ZEROTWO_API: resolveZerotwoApiBase(process.env),
    BOT_DISPLAY_NAME: process.env.BOT_DISPLAY_NAME || 'Hanork',
    BOT_SHOP_TAGLINE: process.env.BOT_SHOP_TAGLINE || 'Loja online',
    GEMINI_KEY: process.env.GEMINI_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '',
    CAMINHO_PRODUTOS: path.join(__dirname, '../../produtos'),
    CAMINHO_FOTOS: path.join(__dirname, '../../fotos'),
    CAMINHO_INFOS: path.join(__dirname, '../../infos'),
    CAMINHO_ASSETS_IMAGES: path.join(__dirname, '../../assets/images'),
    GRUPO_ID: process.env.GRUPO_ID ? parseInt(process.env.GRUPO_ID, 10) : null,
};

const bootGate = { complete: false };
const botHolder = { bot: null };

const adminActivityNotifier = createAdminActivityNotifier({
    token: process.env.TOKEN_TELEGRAM_NOTIFY || process.env.TOKEN_TELEGRAM_ADMIN_NOTIFY || '',
    fallbackToken: process.env.TOKEN_TELEGRAM || '',
    adminIds: (process.env.ADMIN_NOTIFY_IDS || '')
        .split(',')
        .map((x) => parseInt(String(x).trim(), 10))
        .filter(Boolean)
        .length
        ? (process.env.ADMIN_NOTIFY_IDS || '').split(',').map((x) => parseInt(String(x).trim(), 10)).filter(Boolean)
        : CONFIG.ID_DONO,
});

global.adminActivityNotifier = adminActivityNotifier;

if (typeof logger.setConsoleMirrorSink === 'function') {
    logger.setConsoleMirrorSink((plainLine) => {
        adminActivityNotifier?.enqueueConsoleLine?.(plainLine);
    });
}
if (typeof logger.setAdminActivitySink === 'function') {
    logger.setAdminActivitySink((line, userId) => {
        adminActivityNotifier?.notifyPlainLine?.(line, { userId });
    });
}

try {
    eventBus.on('*', async ({ event, data }) => {
        if (!event) return;
        if (event === 'order.paid' || event === 'commission.earned' || event === 'commission.paid') {
            return;
        }
        const enabled =
            process.env.ADMIN_NOTIFY_ALL_EVENTS !== '0' &&
            process.env.ADMIN_NOTIFY_ALL_EVENTS !== 'false';
        if (!enabled) return;
        const payload = data || {};
        const hasUser =
            payload?._userId != null ||
            payload?.userId != null ||
            payload?.telegramId != null ||
            payload?.telegram_id != null;
        if (!hasUser) return;
        adminActivityNotifier?.notifyDomainEvent?.(event, payload);
    });
} catch { /* ignore */ }

const antiSpam = new AntiSpamService({ adminIds: CONFIG.ID_DONO });
const commandLimiter = new CommandRateLimiter(CONFIG.ID_DONO);
const couponAttemptLimiter = new CouponAttemptLimiter();
setInterval(() => couponAttemptLimiter.cleanup(), 300000).unref?.();

const TEXTO = {
    boasVindas:
        `<b>Hanork</b> — produtos digitais com entrega automática no Telegram.\n\n` +
        `✓ PIX ou cartão · entrega neste chat em segundos\n` +
        `✓ <b>Números SMS</b> — <code>/numeros whatsapp brasil</code> ou qualquer app/país\n` +
        `Use os botões: <b>Começar</b>, <b>Números SMS</b>, <b>SMM</b> ou <b>Catálogo</b>.`,
    pagamento: {
        processando: 'Preparando seu pagamento com segurança via Mercado Pago…',
        sucesso:
            '<b>Pagamento confirmado</b>\n\n' +
            'Obrigado pela compra. Seu produto está sendo entregue neste chat. Em geral leva apenas alguns segundos.',
        analise:
            '<b>Pagamento em análise</b>\n\n' +
            'Recebemos sua tentativa de pagamento. Você será avisado aqui assim que for aprovado.',
        falha:
            '<b>Pagamento não localizado</b>\n\n' +
            'Não encontramos confirmação para este pedido. Verifique se o PIX ou cartão foi concluído ou tente novamente pelo menu.',
    },
    carrinho: {
        vazio:
            '<b>Seu carrinho está vazio</b>\n\n' +
            'Explore o <b>Catálogo</b>, escolha os produtos e toque em <b>Adicionar</b>. ' +
            'Quando terminar, use <code>/checkout</code> ou o botão de finalizar compra.',
        itens:
            '<b>Resumo do carrinho</b>\n\n{itens}\n\n<b>Total:</b> R$ {total}\n\n' +
            'Revise os itens e selecione a forma de pagamento abaixo:',
    },
    spam: null,
};

const stateFacades = createBotStateFacades({ State, dbRaw, Markup, prisma, CONFIG });
const {
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
} = stateFacades;

Msg.init(lastMenuMsg, {
    getMenuPhoto: (userId, opts) => getMenuPhotoInput(userId, null, null, opts || {}),
});

let botUsername = '';
let botUsernameTs = 0;
const BOT_USERNAME_TTL = 300000;

async function getBotUsername() {
    const bot = botHolder.bot;
    const now = Date.now();
    if (botUsername && (now - botUsernameTs) < BOT_USERNAME_TTL) return botUsername;
    if (bot?.botInfo?.username) {
        botUsername = bot.botInfo.username;
        botUsernameTs = now;
        return botUsername;
    }
    try {
        const me = await bot.telegram.getMe();
        botUsername = me.username || '';
        botUsernameTs = now;
    } catch { /* ignore */ }
    return botUsername;
}

function invalidateBotUsername() { botUsernameTs = 0; }

const { loadProducts, getProductById, invalidateProductCache } = createCatalogHelpers({ prisma, logger });
const Cart = createCartAdapter(getProductById);
const Menu = createMenuKeyboards(CONFIG, PaymentService);
const MP = require('../modules/payment/MpAdapter');

function escapeMd(text) {
    if (!text) return '';
    return String(text).replace(/([_*`\[\]])/g, '\\$1');
}

function isAdmin(uid) { return CONFIG.ID_DONO.includes(uid); }

let maintenanceMode = false;
const bannedUsers = new Set();
function getMaintenanceMode() { return maintenanceMode; }
function setMaintenanceMode(v) { maintenanceMode = v; }

const productAdmin = createProductAdminBridge({
    getBot: () => botHolder.bot,
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
});

const deliverProducts = (ctxOrTelegram, chatId, items) =>
    deliverProductsFn(ctxOrTelegram, chatId, items, { CONFIG, logger, UserEmailService, monitor });

/**
 * B3 — deps estáveis antes de `new Telegraf` (move-only de bot.js).
 */
function createBotContext() {
    return {
        botHolder,
        bootGate,
        CONFIG,
        Markup,
        Msg,
        groupGuard,
        isShopAreaStartPayload,
        resolveShopStartPayload,
        emailService,
        UserEmailService,
        ProductWizardService,
        ProductAdminService,
        buildProductPhotoFileName,
        prisma,
        backup,
        migrateFromJSON,
        state,
        logger,
        monitor,
        dbRaw,
        BackupManager,
        State,
        eventBus,
        stateManager,
        registry,
        botInstanceLock,
        adminActivityNotifier,
        antiSpam,
        commandLimiter,
        couponAttemptLimiter,
        TEXTO,
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
        getBotUsername,
        invalidateBotUsername,
        loadProducts,
        getProductById,
        invalidateProductCache,
        Cart,
        Menu,
        MP,
        escapeMd,
        isAdmin,
        webhookPaymentDedup,
        mpAmountMatchesOrder,
        getMaintenanceMode,
        setMaintenanceMode,
        bannedUsers,
        CustomerSubscriptionService,
        UserAccountCore,
        UserAccountPanels,
        deliverProducts,
        deferBackground,
        ADMIN_HTML,
        sendAdminPanelWithPhoto,
        editAdminPanel,
        PaymentService,
        UserService,
        AuditService,
        QueueService,
        SafeWebhookHandler,
        SafeDeliveryService,
        warmMenuPhotoCache,
        productWizard: productAdmin.productWizard,
        catalogSearchMode: productAdmin.catalogSearchMode,
        onboardingStep: productAdmin.onboardingStep,
        resgateTentativas: productAdmin.resgateTentativas,
        botSession: productAdmin.botSession,
        sessionNote: productAdmin.sessionNote,
        clearAllProductAdminSessions: productAdmin.clearAllProductAdminSessions,
        beginProductFieldEdit: productAdmin.beginProductFieldEdit,
        beginProductCreateFlow: productAdmin.beginProductCreateFlow,
        openProductAdminPanelWithCleanSessions: productAdmin.openProductAdminPanelWithCleanSessions,
        wizardDeps: productAdmin.wizardDeps,
        productAdminDeps: productAdmin.productAdminDeps,
        openProductAdminPanel: productAdmin.openProductAdminPanel,
        setBotUsername: (name) => {
            botUsername = name;
            botUsernameTs = Date.now();
        },
        getBotUsernameCached: () => botUsername,
    };
}

module.exports = { createBotContext };
