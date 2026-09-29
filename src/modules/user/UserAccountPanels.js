'use strict';

const { Markup } = require('telegraf');
const { getSalesRefChannelUrl } = require('../../config/salesReferenceChannel');
const UserEmailService = require('../../services/UserEmailService');
const CustomerSubscriptionService = require('../subscription/CustomerSubscriptionService');
const { formatRegistrationDate } = require('./UserAccountCore');
const { MENU_BTN } = require('../../telegram/menus/menuCopy');
const { CB } = require('../../telegram/callbacks/constants');

function buildAccountPanelText(summary, ctxFrom) {
    const { user, loyalty, affiliateBalance, walletBalance, orderCount, deliveredCount, cashbackAvailable, subscription } = summary;
    const name = ctxFrom?.first_name || user.first_name || 'Usuário';
    const premiumLine = subscription
        ? `💎 <b>Premium:</b> Ativo até ${new Date(subscription.next_payment_date).toLocaleDateString('pt-BR')}\n`
        : `💎 <b>Premium:</b> Não assinante\n`;

    return (
        `👤 <b>Minha Conta</b>\n\n` +
        `<b>${name}</b>\n` +
        `🆔 ID: <code>${user.telegram_id}</code>\n` +
        `📅 Cadastro: ${formatRegistrationDate(user.created_at)}\n\n` +
        premiumLine +
        `💎 <b>Nível:</b> ${String(loyalty?.level || 'bronze').toUpperCase()}\n` +
        `⭐ <b>Pontos:</b> ${loyalty?.points || 0}\n` +
        `💰 <b>Cashback:</b> R$ ${cashbackAvailable.toFixed(2)}\n` +
        `💳 <b>Carteira Hanork:</b> R$ ${Number(walletBalance || 0).toFixed(2)}` +
        (walletBalance > 0 ? ' · <i>use no checkout (produtos, SMM, SMS)</i>' : ' · <i>créditos de pedidos com falha</i>') +
        `\n` +
        `🤝 <b>Saldo afiliado:</b> R$ ${affiliateBalance.toFixed(2)}` +
        (affiliateBalance > 0 ? ' · <i>use no checkout ou saque</i>' : '') +
        `\n\n` +
        `📦 <b>Pedidos:</b> ${orderCount} (${deliveredCount} concluídos)\n\n` +
        `${UserEmailService.formatEmailStatus(user)}\n\n` +
        `Escolha abaixo o que deseja consultar ou gerenciar:`
    );
}

function buildMeusDadosText(summary) {
    const { user, loyalty, affiliate, affiliateBalance, cashbackAvailable, subscription } = summary;
    let txt =
        `👤 <b>Seus Dados</b>\n\n` +
        `🆔 ID: <code>${user.telegram_id}</code>\n` +
        `👤 Nome: ${[user.first_name, user.last_name].filter(Boolean).join(' ') || 'N/A'}\n`;

    txt += user.email_verified
        ? `📧 E-mail: ${UserEmailService.maskEmail(user.email)} ✅\n`
        : user.email
            ? `📧 E-mail: ${UserEmailService.maskEmail(user.email)} (não verificado)\n`
            : `📧 E-mail: não cadastrado — use /email\n`;

    txt += `📅 Cadastro: ${formatRegistrationDate(user.created_at)}\n\n`;
    txt += subscription
        ? `💎 Premium: ✅ ${subscription.plan_name} (até ${new Date(subscription.next_payment_date).toLocaleDateString('pt-BR')})\n`
        : `💎 Premium: ❌ Não assinante\n`;
    txt += `⭐ Pontos: ${loyalty?.points || 0}\n`;
    txt += `💰 Cashback: R$ ${cashbackAvailable.toFixed(2)}\n`;
    if (affiliate) {
        txt += `🤝 Afiliado: Sim — saldo R$ ${affiliateBalance.toFixed(2)}\n`;
    }
    return txt;
}

function accountPanelKeyboard(summary) {
    const user = summary?.user || summary;
    const walletBalance = Number(summary?.walletBalance ?? 0);
    const affiliateBalance = Number(summary?.affiliateBalance ?? 0);
    const emailRows = UserEmailService.buildEmailKeyboard(user);
    const affLabel =
        affiliateBalance > 0
            ? `🤝 Afiliado R$ ${affiliateBalance.toFixed(2).replace('.', ',')}`
            : '🤝 Afiliado';

    return Markup.inlineKeyboard([
        ...emailRows,
        [{ text: MENU_BTN.carteira(walletBalance), callback_data: 'user:wallet' }, { text: affLabel, callback_data: 'user:afiliado' }],
        [{ text: '📋 Meus Pedidos', callback_data: 'order:list' }, { text: '📦 Rastrear', callback_data: 'order:track' }],
        [{ text: '🔄 Reenviar', callback_data: 'order:resend' }, { text: '❤️ Favoritos', callback_data: 'user:favoritos' }],
        [{ text: '🏷️ Cupom', callback_data: 'user:cupom' }, { text: '💎 Assinatura', callback_data: 'subscription:view' }],
        [{ text: MENU_BTN.downloads, callback_data: CB.DOWNLOADS_OPEN }],
        [{ text: '🏠 Menu', callback_data: 'menu:home' }],
    ]);
}

function meusDadosKeyboard(hasSubscription) {
    const rows = [
        [{ text: '👤 Minha Conta', callback_data: 'menu:minha_conta' }],
        [{ text: '💎 Assinatura', callback_data: 'subscription:view' }],
    ];
    if (!hasSubscription) {
        rows.unshift([{ text: '💎 Assinar Premium', callback_data: 'subscription:view' }]);
    }
    rows.push([{ text: '🏠 Menu', callback_data: 'home' }]);
    return Markup.inlineKeyboard(rows);
}

function refChannelUrl() {
    return getSalesRefChannelUrl();
}

function subscriptionActiveKeyboard(sub) {
    const rows = [[{ text: CHANNEL_UI.menuLegacy, url: refChannelUrl() }]];
    if (sub.status === 'active') {
        rows.push([{ text: '❌ Cancelar renovação', callback_data: 'subscription:cancel' }]);
    }
    rows.push(
        [{ text: '🔄 Renovar agora', callback_data: 'subscription:view' }],
        [{ text: '👤 Minha Conta', callback_data: 'menu:minha_conta' }],
        [{ text: '🏠 Menu', callback_data: 'home' }]
    );
    return Markup.inlineKeyboard(rows);
}

function subscriptionInactiveKeyboard(product) {
    if (!product) {
        return Markup.inlineKeyboard([
            [{ text: '👤 Minha Conta', callback_data: 'menu:minha_conta' }],
            [{ text: '🏠 Menu', callback_data: 'home' }],
        ]);
    }
    return Markup.inlineKeyboard([
        [{ text: '💎 Assinar Agora', callback_data: `subscription:buy:${product.id}` }],
        [{ text: '🛍️ Ver Catálogo', callback_data: 'cat' }],
        [{ text: '👤 Minha Conta', callback_data: 'menu:minha_conta' }],
        [{ text: '🏠 Menu', callback_data: 'home' }],
    ]);
}

module.exports = {
    buildAccountPanelText,
    buildMeusDadosText,
    accountPanelKeyboard,
    meusDadosKeyboard,
    subscriptionActiveKeyboard,
    subscriptionInactiveKeyboard,
    CustomerSubscriptionService,
};
