'use strict';

/** Linha extra na tela de pagamento — saldo da carteira Hanork. */
function buildCheckoutWalletHint(walletSaldo, total) {
    const saldo = Number(walletSaldo) || 0;
    const pedido = Number(total) || 0;
    if (saldo <= 0 || pedido <= 0) return '';
    if (saldo >= pedido) {
        return (
            `\n\n💳 <b>Carteira Hanork:</b> R$ ${saldo.toFixed(2)}\n` +
            `<i>Pague este pedido inteiro com seu saldo (produtos, SMM ou SMS).</i>`
        );
    }
    const falta = pedido - saldo;
    return (
        `\n\n💳 <b>Carteira Hanork:</b> R$ ${saldo.toFixed(2)}\n` +
        `<i>Faltam R$ ${falta.toFixed(2)} para pagar com carteira. Use PIX ou acumule saldo.</i>`
    );
}

function buildWalletPanelText(user, balance, ledger = []) {
    const lines = (ledger || []).slice(0, 6).map((row) => {
        const sign = row.direction === 'credit' ? '+' : '−';
        const amt = Number(row.amount).toFixed(2);
        const when = row.created_at ? String(row.created_at).slice(0, 16).replace('T', ' ') : '';
        const ref = row.order_id ? `#${String(row.order_id).slice(-6)}` : '';
        return `• ${sign} R$ ${amt} ${ref} · <i>${when}</i>`;
    });
    return (
        `💳 <b>Carteira Hanork</b>\n\n` +
        `Saldo disponível: <b>R$ ${Number(balance || 0).toFixed(2)}</b>\n\n` +
        `<i>Use em produtos, serviços SMM ou números SMS no checkout.</i>\n` +
        `<i>Quando um pedido pago não concluir (sem estoque/número), o PIX vira saldo aqui — sem esperar reembolso.</i>` +
        (lines.length ? `\n\n<b>Últimos movimentos</b>\n${lines.join('\n')}` : '')
    );
}

function walletPanelKeyboard() {
    const { Markup } = require('telegraf');
    const { CB } = require('../../telegram/callbacks/constants');
    return Markup.inlineKeyboard([
        [{ text: '🛍️ Catálogo', callback_data: CB.CATALOG_VIEW }],
        [{ text: '📱 SMM', callback_data: CB.SMM_HOME }, { text: '📞 SMS', callback_data: CB.VIRTUO_HOME }],
        [{ text: '👤 Minha conta', callback_data: CB.MENU_ACCOUNT }],
        [{ text: '🏠 Menu', callback_data: CB.MENU_HOME }],
    ]);
}

module.exports = {
    buildCheckoutWalletHint,
    buildWalletPanelText,
    walletPanelKeyboard,
};
