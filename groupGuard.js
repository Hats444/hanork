'use strict';

/**
 * Separação grupo (público, limitado) vs privado (compras, pagamentos, conta).
 */
const { Markup } = require('telegraf');

const GROUP_BLOCKED_PATTERNS = [
    /^buy_\d+$/,
    /^add_\d+$/,
    /^pp_/,
    /^pc_/,
    /^check_/,
    /^cancel_/,
    /^copypix_/,
    /^ck_/,
    /^aff_pay_/,
    /^checkout$/,
    /^cart$/,
    /^clr$/,
    /^payment:/,
    /^checkout:/,
    /^cart:/,
    /^order:/,
    /^menu:minha_conta$/,
    /^subscription:buy/,
    /^resend_/,
    /^refund_/,
    /^usuarios_/,
    /^ui_/,
    /^flash:buy:/,
    /^fs_buy_/,
    /^rate_/,
    /^smm:cp$/,
    /^smm:cx:/,
    /^smm:rf:/,
];

const GROUP_ALLOWED_PATTERNS = [
    /^catalog:view$/,
    /^cat$/,
    /^cat_pg_\d+$/,
    /^cat_hub$/,
    /^cat_list_\d+$/,
    /^cat_list_\d+_[a-z]+$/,
    /^cat_f_[a-z0-9]+_\d+$/,
    /^cat_search$/,
    /^p_\d+$/,
    /^menu:home$/,
    /^home$/,
    /^help:open$/,
    /^help:/,
    /^downloads:/,
    /^flash:sales$/,
    /^flash:view$/,
    /^search:open$/,
    /^help_sec_/,
    /^noop$/,
    /^cat_nav$/,
];

const GROUP_ALLOWED_COMMANDS = new Set([
    '/start',
    '/help',
    '/comandos',
    '/cat',
    '/catalogo',
    '/id',
    '/grupo',
    '/atualizarlink',
]);

const GROUP_ADMIN_COMMAND_PREFIXES = ['/grupo', '/admin'];

const PRIVATE_ONLY_COMMANDS = new Set([
    '/checkout',
    '/pix',
    '/carrinho',
    '/cart',
    '/cupom',
    '/saldo',
    '/meusdados',
    '/email',
    '/afiliado',
    '/rendimentos',
    '/compartilhar',
    '/favoritos',
    '/rastrear',
    '/pontos',
    '/cashback',
    '/assinatura',
    '/flashsales',
    '/suporte',
    '/tickets',
    '/reenviar',
    '/reembolso',
    '/smm',
    '/servicos',
    '/buscar',
    '/smm_buscar',
    '/smm_pedidos',
]);

function isGroupChat(ctx) {
    const t = ctx.chat?.type ?? ctx.callbackQuery?.message?.chat?.type;
    return t === 'group' || t === 'supergroup';
}

function isPrivateChat(ctx) {
    return !isGroupChat(ctx);
}

function isAdminGroupCallback(data, isAdmin, uid) {
    if (!isAdmin?.(uid)) return false;
    return /^(a_|grp_|bcast_|grupos_|email_|gw_|adm_|fs_|toggle_)/.test(data) || data === 'home_user';
}

function isCallbackAllowedInGroup(ctx, data, isAdmin, uid) {
    if (!data || !isGroupChat(ctx) || isPrivateChat(ctx)) return true;
    if (GROUP_BLOCKED_PATTERNS.some((re) => re.test(data))) return false;
    if (/^(payment|checkout|cart|order|user|subscription):/.test(data)) return false;
    if (isAdminGroupCallback(data, isAdmin, uid)) return true;
    if (/^(play|tiktok|downloads):/.test(data)) {
        const downloadsGuard = require('./downloadsGuard');
        if (isAdmin?.(uid)) return true;
        return downloadsGuard.isDownloadsAllowedChat(ctx);
    }
    if (GROUP_ALLOWED_PATTERNS.some((re) => re.test(data))) return true;
    return false;
}

function isCommandAllowedInGroup(cmdText, isAdmin, uid) {
    const cmd = (cmdText || '').split(/\s+/)[0].toLowerCase().replace(/@\w+$/, '');
    if (!cmd.startsWith('/')) return true;
    if (isAdmin?.(uid)) return true;
    if (GROUP_ALLOWED_COMMANDS.has(cmd)) return true;
    if (PRIVATE_ONLY_COMMANDS.has(cmd)) return false;
    return true;
}

async function getBotUsername(bot) {
    if (process.env.BOT_USERNAME) return String(process.env.BOT_USERNAME).replace('@', '');
    if (bot?.botInfo?.username) return bot.botInfo.username;
    try {
        const me = await Promise.race([
            bot.telegram.getMe(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('getMe timeout')), 4000)),
        ]);
        if (me?.username) return me.username;
    } catch {
        /* fallback abaixo */
    }
    return 'bot';
}

function privateUrl(botUsername, startPayload = null) {
    if (!startPayload) return `https://t.me/${botUsername}`;
    // Payload Telegram: A-Za-z0-9_ (buy_15). encodeURIComponent preserva underscore.
    const payload = String(startPayload).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
    return payload
        ? `https://t.me/${botUsername}?start=${encodeURIComponent(payload)}`
        : `https://t.me/${botUsername}`;
}

async function replyGroupRedirect(ctx, bot, opts = {}) {
    const username = await getBotUsername(bot);
    const title = opts.title || '🔒 Compra no privado';
    const body =
        opts.body ||
        'Por segurança, <b>pagamentos, entrega de produtos e dados da sua conta</b> só funcionam em conversa privada com o bot.\n\n' +
        'Toque no botão abaixo para continuar.';
    const url = privateUrl(username, opts.startPayload || null);
    const text = `<b>${title}</b>\n\n${body}`;
    const kb = Markup.inlineKeyboard([
        [{ text: opts.buttonText || '💬 Abrir no privado', url }],
    ]);
    try {
        if (ctx.callbackQuery) {
            await ctx.answerCbQuery(opts.alert || '🔒 Use no privado', { show_alert: !!opts.showAlert });
        }
        await ctx.reply(text, { parse_mode: 'HTML', ...kb });
    } catch (e) {
        const logger = require('../config/logger');
        logger.warn('[groupGuard] replyGroupRedirect:', e.message);
    }
}

async function handleGroupCallback(ctx, bot, isAdmin) {
    if (!ctx.callbackQuery?.data || !isGroupChat(ctx) || isPrivateChat(ctx)) return false;
    const data = ctx.callbackQuery.data;
    if (!isCallbackAllowedInGroup(ctx, data, isAdmin, ctx.from?.id)) {
        const downloadsGuard = require('./downloadsGuard');
        if (downloadsGuard.isDownloadsRelatedCallback(data)) {
            await downloadsGuard.replyDenied(ctx, bot);
            return true;
        }
        let startPayload = null;
        const buy = data.match(/^buy_(\d+)$/);
        const prod = data.match(/^p_(\d+)$/);
        if (buy) startPayload = `buy_${buy[1]}`;
        else if (prod) startPayload = `produto_${prod[1]}`;
        await replyGroupRedirect(ctx, bot, {
            startPayload,
            buttonText: startPayload ? '✅ Abrir privado' : '💬 Abrir privado',
            showAlert: true,
            body:
                'Esta ação não está disponível em <b>grupos</b>.\n\n' +
                (startPayload
                    ? 'Toque no botão abaixo, depois em <b>Iniciar</b> no bot — o pagamento abre automaticamente no privado.'
                    : 'Abra o bot no privado para comprar, pagar ou ver sua conta.'),
        });
        return true;
    }
    return false;
}

async function handleGroupCommand(ctx, bot, isAdmin) {
    if (!ctx.message?.text?.startsWith('/') || !isGroupChat(ctx) || isPrivateChat(ctx)) return false;
    const downloadsGuard = require('./downloadsGuard');
    if (downloadsGuard.isDownloadCommand(ctx.message.text)) {
        if (downloadsGuard.canUseDownloads(ctx)) return false;
        await downloadsGuard.replyDenied(ctx, bot);
        return true;
    }
    if (isCommandAllowedInGroup(ctx.message.text, isAdmin, ctx.from?.id)) return false;
    await replyGroupRedirect(ctx, bot, {
        body: `O comando <code>${ctx.message.text.split(/\s+/)[0]}</code> só está disponível em conversa privada.`,
    });
    return true;
}

async function sendGroupWelcome(ctx, bot, opts = {}) {
    const username = await getBotUsername(bot);
    const nome = ctx.from?.first_name ? ` ${ctx.from.first_name}` : '';
    const chatTitle = ctx.chat?.title ? ` em <b>${ctx.chat.title}</b>` : '';
    const text =
        `👋 Olá${nome}!\n\n` +
        `Neste grupo você pode <b>ver o catálogo</b> e acompanhar promoções da Hanork.\n\n` +
        `<b>O que funciona aqui:</b> listar produtos e ver detalhes.\n` +
        `<b>O que fica no privado:</b> carrinho, pagamento PIX/cartão e entrega dos arquivos — ` +
        `assim seus dados ficam protegidos.\n\n` +
        `<i>Use /cat para navegar ou abra o bot no privado para comprar.</i>`;
    const rows = [
        [{ text: '🛍️ Catálogo', callback_data: 'catalog:view' }],
        [{ text: '💬 Abrir privado', url: privateUrl(username, 'comprar') }],
        [{ text: '❓ Ajuda', callback_data: 'help:open' }],
    ];
    if (opts.supportUrl) {
        rows.push([{ text: '📞 Suporte', url: opts.supportUrl }]);
    }
    await ctx.reply(text, {
        parse_mode: 'HTML',
        reply_markup: Markup.inlineKeyboard(rows).reply_markup,
    }).catch(async (e) => {
        const logger = require('../config/logger');
        logger.warn('[groupGuard] sendGroupWelcome:', e.message);
        try {
            await ctx.reply('👋 Abra o bot no privado para comprar: ' + privateUrl(username), {
                disable_web_page_preview: true,
            });
        } catch { /* ignore */ }
    });
}

async function sendGroupProductPreview(ctx, bot, product) {
    const username = await getBotUsername(bot);
    const { buildBuyerProductText } = require('../utils/productListing');
    let text = buildBuyerProductText(product, { showStock: false });
    text += `\n\n<i>🔒 Compra e entrega apenas no privado.</i>`;
    const kb = Markup.inlineKeyboard([
        [{ text: '✅ Comprar no privado', url: privateUrl(username, `buy_${product.id}`) }],
        [{ text: '🔙 Catálogo', callback_data: 'catalog:view' }, { text: '🏠 Início', callback_data: 'menu:home' }],
    ]);
    if (ctx.callbackQuery) {
        await ctx.answerCbQuery().catch(() => {});
        try {
            return await ctx.editMessageText(text, { parse_mode: 'HTML', ...kb });
        } catch {
            return await ctx.reply(text, { parse_mode: 'HTML', ...kb });
        }
    }
    return ctx.reply(text, { parse_mode: 'HTML', ...kb });
}

async function sendGroupCatalogView(ctx, products, view = { mode: 'hub' }) {
    const catalogUi = require('./catalogUi');
    let { text, rows } = catalogUi.buildCatalogView(products, view);
    text += `\n\n<i>Toque em um produto · compra só no privado.</i>`;
    const markup = Markup.inlineKeyboard(rows);
    if (ctx.callbackQuery) {
        await ctx.answerCbQuery().catch(() => {});
        try {
            return await ctx.editMessageText(text, { parse_mode: 'HTML', ...markup });
        } catch {
            return await ctx.reply(text, { parse_mode: 'HTML', ...markup });
        }
    }
    return ctx.reply(text, { parse_mode: 'HTML', ...markup });
}

/** @deprecated use sendGroupCatalogView */
async function sendGroupCatalogPage(ctx, products, page) {
    return sendGroupCatalogView(ctx, products, { mode: 'list', page });
}

async function requirePrivate(ctx, bot, opts = {}) {
    if (!isGroupChat(ctx)) return true;
    await replyGroupRedirect(ctx, bot, opts);
    return false;
}

module.exports = {
    isGroupChat,
    isPrivateChat,
    isCallbackAllowedInGroup,
    isCommandAllowedInGroup,
    handleGroupCallback,
    handleGroupCommand,
    replyGroupRedirect,
    sendGroupWelcome,
    sendGroupProductPreview,
    sendGroupCatalogPage,
    sendGroupCatalogView,
    requirePrivate,
    privateUrl,
};
