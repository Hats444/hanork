'use strict';

const { Markup } = require('telegraf');
const { connect: dbConnect } = require('../../config/database-sqlite');
const {
    affiliateStartLink,
    affiliateEarnings,
    getCommissionHistory,
    formatCommissionPercent,
} = require('./AffiliateCore');
const { WITHDRAW_MIN } = require('./affiliateConfig');

function formatWithdrawStatus(status) {
    switch (status) {
        case 'pending': return '⏳ Em análise';
        case 'approved': return '✅ Aprovado — PIX em processamento';
        case 'rejected': return '❌ Recusado — saldo devolvido';
        default: return status || '—';
    }
}

/** Linha extra na tela de pagamento — evita botão enganoso de saldo parcial. */
function buildCheckoutAffiliateHint(affSaldo, total) {
    const saldo = Number(affSaldo) || 0;
    const pedido = Number(total) || 0;
    if (saldo <= 0 || pedido <= 0) return '';
    if (saldo >= pedido) {
        return (
            `\n\n💰 <b>Saldo afiliado:</b> R$ ${saldo.toFixed(2)}\n` +
            `<i>Você pode pagar este pedido inteiro com saldo.</i>`
        );
    }
    const falta = pedido - saldo;
    return (
        `\n\n💰 <b>Saldo afiliado:</b> R$ ${saldo.toFixed(2)}\n` +
        `<i>Acumule mais R$ ${falta.toFixed(2)} para pagar pedidos com saldo (valor integral).</i>`
    );
}

/** Texto plano para o botão «Compartilhar no Telegram» — link vai só no parâmetro url (evita duplicar). */
function buildShareInvitePlainText() {
    return (
        `🛍️ Hanork — loja digital no Telegram\n\n` +
        `✅ Produtos digitais com entrega automática\n` +
        `✅ PIX e cartão · pagamento seguro\n` +
        `✅ Serviços SMM: seguidores, curtidas e views\n\n` +
        `👇 Toque no link abaixo para entrar na loja:`
    );
}

function buildAffiliatePanelText(aff, botUsername) {
    const link = affiliateStartLink(botUsername, aff.code);
    const earnings = affiliateEarnings(aff);
    const pct = formatCommissionPercent();
    const indicados = aff.referred_count || 0;
    const vendas = aff.sales_count || 0;
    const taxaConv = indicados > 0 ? Math.round((vendas / indicados) * 100) : 0;

    return (
        `🤝 <b>Programa de Afiliados</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `💰 <b>Saldo disponível</b>\n` +
        `   R$ ${earnings.toFixed(2)}\n\n` +
        `📊 <b>Desempenho</b>\n` +
        `   👥 Indicados: ${indicados}\n` +
        `   ✅ Vendas com comissão: ${vendas}\n` +
        (indicados > 0 ? `   📈 Conversão: ${taxaConv}%\n` : '') +
        `\n🔗 <b>Seu link de indicação</b>\n` +
        `<code>${link}</code>\n\n` +
        `📌 <b>Como funciona</b>\n` +
        `1️⃣ Compartilhe seu link com amigos e grupos\n` +
        `2️⃣ A pessoa entra na loja pelo seu link\n` +
        `3️⃣ Você recebe <b>${pct}</b> em <b>cada compra</b> dela após a entrega\n\n` +
        `💸 Use o saldo na loja ou solicite saque via PIX (mín. R$ ${WITHDRAW_MIN.toFixed(2)}).`
    );
}

function buildSharePanelText(aff, botUsername) {
    const link = affiliateStartLink(botUsername, aff.code);
    const pct = formatCommissionPercent();
    return (
        `📤 <b>Indique e ganhe</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `Compartilhe seu link exclusivo. Quando alguém entrar pela loja com ele, você ganha comissão em <b>todas as compras</b> dessa pessoa — não só na primeira.\n\n` +
        `💰 <b>${pct}</b> de comissão por pedido entregue\n` +
        `🛒 Produtos digitais, serviços SMM e mais\n` +
        `💸 Saldo para comprar na loja ou sacar via PIX\n\n` +
        `🔗 <b>Seu link:</b>\n<code>${link}</code>\n\n` +
        `<i>Toque em «Compartilhar no Telegram» — a mensagem já vai pronta.</i>`
    );
}

function buildRendimentosText(aff, userId) {
    const earnings = affiliateEarnings(aff);
    const history = getCommissionHistory(aff.id, 8);
    let txt =
        `💰 <b>Rendimentos</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `<b>Saldo disponível:</b> R$ ${earnings.toFixed(2)}\n` +
        `<b>Indicados:</b> ${aff.referred_count || 0}\n` +
        `<b>Vendas com comissão:</b> ${aff.sales_count || 0}\n\n`;

    if (history.length) {
        txt += `<b>Últimas comissões</b>\n`;
        for (const h of history) {
            const oid = h.order_id ? `#${String(h.order_id).slice(-8)}` : '—';
            const comm = Number(h.commission || 0).toFixed(2);
            const dt = h.created_at ? String(h.created_at).slice(0, 10) : '';
            const who = h.buyer_name || h.buyer_username || '';
            const whoTxt = who ? ` · ${String(who).slice(0, 18)}` : '';
            txt += `• ${oid} — R$ ${comm}${whoTxt}${dt ? ` · ${dt}` : ''}\n`;
        }
        txt += '\n';
    } else {
        txt += `<i>Nenhuma comissão recebida ainda. Compartilhe seu link para começar!</i>\n\n`;
    }

    txt +=
        `💸 <b>Saque via PIX</b>\n` +
        `Mínimo: R$ ${WITHDRAW_MIN.toFixed(2)} · valor integral do saldo\n` +
        `Prazo habitual: até 3 dias úteis após aprovação`;

    return txt;
}

function buildSaldoText(aff, botUsername) {
    const link = affiliateStartLink(botUsername, aff.code);
    const earnings = affiliateEarnings(aff);
    return (
        `💰 <b>Saldo de Afiliado</b>\n\n` +
        `<b>Disponível:</b> R$ ${earnings.toFixed(2)}\n` +
        `<b>Indicados:</b> ${aff.referred_count || 0}\n` +
        `<b>Vendas com comissão:</b> ${aff.sales_count || 0}\n\n` +
        `🔗 <code>${link}</code>`
    );
}

function affiliatePanelKeyboard(isCommand = false) {
    const back = isCommand
        ? [{ text: '🏠 Menu', callback_data: 'home' }]
        : [{ text: '🔙 Voltar', callback_data: 'menu:minha_conta' }];
    return Markup.inlineKeyboard([
        [{ text: '📤 Compartilhar', callback_data: 'user:indicar' }],
        [{ text: '💰 Rendimentos e saque', callback_data: 'user:rendimentos' }],
        back,
    ]);
}

function saldoKeyboard() {
    return Markup.inlineKeyboard([
        [{ text: '💰 Rendimentos / Saque', callback_data: 'user:rendimentos' }],
        [{ text: '🤝 Painel afiliado', callback_data: 'user:afiliado' }],
        [{ text: '🏠 Menu', callback_data: 'home' }],
    ]);
}

function withdrawSupportRows(backCallback = 'user:rendimentos') {
    const supportUrl = process.env.CONTATO_ESPECIALISTA || 'https://t.me/hanorkoff';
    return [
        [{ text: '📞 Falar com Suporte', url: supportUrl }],
        [{ text: '🎫 Suporte no Bot', callback_data: 'suporte_start' }],
        [{ text: '🔙 Voltar', callback_data: backCallback }],
    ];
}

function rendimentosKeyboard(userId, earnings) {
    let pendingWd = null;
    try {
        const db = dbConnect();
        pendingWd = db?.prepare(
            "SELECT id, amount FROM affiliate_withdrawals WHERE user_id = ? AND status = 'pending' LIMIT 1"
        ).get(userId);
    } catch {
        pendingWd = null;
    }

    const wdRow = pendingWd
        ? [{ text: `⏳ Saque pendente — R$ ${Number(pendingWd.amount).toFixed(2)}`, callback_data: 'user:withdraw_status' }]
        : earnings >= WITHDRAW_MIN
            ? [{ text: '💸 Solicitar saque PIX', callback_data: 'user:withdraw' }]
            : [{ text: `💸 Saque (mín. R$ ${WITHDRAW_MIN.toFixed(0)})`, callback_data: 'user:withdraw' }];

    return Markup.inlineKeyboard([
        wdRow,
        [{ text: '📤 Compartilhar link', callback_data: 'user:indicar' }],
        [{ text: '🤝 Painel afiliado', callback_data: 'user:afiliado' }],
        [{ text: '🔙 Voltar', callback_data: 'menu:minha_conta' }],
    ]);
}

function shareKeyboard(link) {
    const text = buildShareInvitePlainText();
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
    return Markup.inlineKeyboard([
        [{ text: '📤 Compartilhar no Telegram', url: shareUrl }],
        [{ text: '🤝 Painel afiliado', callback_data: 'user:afiliado' }],
        [{ text: '🔙 Voltar', callback_data: 'menu:minha_conta' }],
    ]);
}

function notAffiliateKeyboard() {
    return Markup.inlineKeyboard([
        [{ text: '🤝 Ativar painel afiliado', callback_data: 'user:afiliado' }],
        [{ text: '🏠 Menu', callback_data: 'home' }],
    ]);
}

module.exports = {
    buildAffiliatePanelText,
    buildSharePanelText,
    buildShareInvitePlainText,
    buildRendimentosText,
    buildSaldoText,
    buildCheckoutAffiliateHint,
    formatWithdrawStatus,
    affiliatePanelKeyboard,
    saldoKeyboard,
    rendimentosKeyboard,
    withdrawSupportRows,
    shareKeyboard,
    notAffiliateKeyboard,
    WITHDRAW_MIN,
};
