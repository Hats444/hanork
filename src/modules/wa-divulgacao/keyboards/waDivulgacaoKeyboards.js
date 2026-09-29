'use strict';

const { Markup } = require('telegraf');
const { CB } = require('../../../telegram/callbacks/constants');

function plansKeyboard(products = []) {
    const rows = [];
    for (let i = 0; i < products.length; i += 2) {
        const left = products[i];
        const right = products[i + 1];
        const row = [];
        if (left) {
            const days = require('../waDivulgacaoPlans').parsePlanDaysFromProduct(left);
            row.push({
                text: `💳 ${days}d — R$ ${Number(left.price).toFixed(0)}`,
                callback_data: `wadv:buy:${left.id}`,
            });
        }
        if (right) {
            const days = require('../waDivulgacaoPlans').parsePlanDaysFromProduct(right);
            row.push({
                text: `💳 ${days}d — R$ ${Number(right.price).toFixed(0)}`,
                callback_data: `wadv:buy:${right.id}`,
            });
        }
        if (row.length) rows.push(row);
    }
    rows.push([{ text: '🏠 Menu', callback_data: CB.MENU_HOME }]);
    return Markup.inlineKeyboard(rows);
}

function connectChoiceKeyboard() {
    return Markup.inlineKeyboard([
        [
            { text: '📱 QR Code', callback_data: 'wadv:connect:qr' },
            { text: '🔢 Código', callback_data: 'wadv:connect:pair' },
        ],
        [{ text: '🔙 Voltar ao painel', callback_data: 'wadv:home' }],
    ]);
}

function activePanelKeyboard(sub, connected = false) {
    const rows = [];
    if (!connected) {
        rows.push([{ text: '📱 Conectar WhatsApp', callback_data: 'wadv:connect' }]);
    } else {
        rows.push([{ text: '📱 Meu WhatsApp', callback_data: 'wadv:my_wa' }]);
    }
    rows.push(
        [
            { text: '📣 Campanhas', callback_data: 'wadv:campaigns' },
            { text: '📊 Estatísticas', callback_data: 'wadv:stats' },
        ],
        [
            { text: '📋 Histórico', callback_data: 'wadv:history' },
            { text: '⏰ Agendadas', callback_data: 'wadv:scheduled' },
        ],
        [
            { text: '👥 Meus grupos', callback_data: 'wadv:groups' },
            { text: '➕ Entrar em grupos', callback_data: 'wadv:join' },
        ],
        [{ text: '⚙️ Configurações', callback_data: 'wadv:settings' }],
        [{ text: '🔄 Renovar plano', callback_data: 'wadv:plans' }]
    );
    if (sub?.status === 'active') {
        rows.push([{ text: '❌ Cancelar renovação', callback_data: 'wadv:cancel' }]);
    }
    rows.push([{ text: '🏠 Menu', callback_data: CB.MENU_HOME }]);
    return Markup.inlineKeyboard(rows);
}

function stubBackKeyboard(back = 'wadv:home') {
    return Markup.inlineKeyboard([
        [{ text: '🔙 Voltar ao painel', callback_data: back }],
        [{ text: '🏠 Menu', callback_data: CB.MENU_HOME }],
    ]);
}

function postPaymentKeyboard() {
    return Markup.inlineKeyboard([
        [{ text: '🚀 Abrir Hanork Div', callback_data: 'wadv:home' }],
        [{ text: '📱 Conectar WhatsApp', callback_data: 'wadv:connect' }],
        [{ text: '🏠 Menu', callback_data: CB.MENU_HOME }],
    ]);
}

function phonePromptKeyboard() {
    return Markup.inlineKeyboard([
        [{ text: '🔙 Voltar', callback_data: 'wadv:connect' }],
        [{ text: '🏠 Painel Div', callback_data: 'wadv:home' }],
    ]);
}

function formatPairCodeForCopy(raw) {
    const digits = String(raw || '').replace(/\D/g, '').slice(0, 8);
    if (digits.length === 8) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
    const alnum = String(raw || '')
        .replace(/[^a-zA-Z0-9]/g, '')
        .slice(0, 8)
        .toUpperCase();
    if (alnum.length === 8) return `${alnum.slice(0, 4)}-${alnum.slice(4)}`;
    const t = String(raw || '').trim();
    return t || null;
}

function pairCopyButton(pairCode) {
    const formatted = formatPairCodeForCopy(pairCode);
    if (!formatted) return null;
    const digits = formatted.replace(/\D/g, '');
    const toCopy = digits.length === 8 ? digits : formatted;
    return {
        text: `📋 Copiar ${formatted}`,
        copy_text: { text: toCopy },
    };
}

function pairingFlowKeyboard(pairCode = null, opts = {}) {
    const rows = [];
    if (pairCode) {
        if (opts.useCallbackCopy) {
            const formatted = formatPairCodeForCopy(pairCode);
            if (formatted) {
                rows.push([{ text: `📋 Copiar ${formatted}`, callback_data: 'wadv:copy_pair' }]);
            }
        } else {
            const copyBtn = pairCopyButton(pairCode);
            if (copyBtn) rows.push([copyBtn]);
        }
    }
    rows.push(
        [{ text: '🔙 Voltar à conexão', callback_data: 'wadv:connect' }],
        [
            { text: '🔄 Novo código', callback_data: 'wadv:connect:retry_pair' },
            { text: '📱 QR Code', callback_data: 'wadv:connect:qr' },
        ],
        [{ text: '🚀 Painel Div', callback_data: 'wadv:home' }],
        [{ text: '🏠 Menu', callback_data: CB.MENU_HOME }]
    );
    return Markup.inlineKeyboard(rows);
}

function qrFlowKeyboard() {
    return Markup.inlineKeyboard([
        [
            { text: '🔄 Atualizar QR', callback_data: 'wadv:connect:qr' },
            { text: '🔢 Código', callback_data: 'wadv:connect:pair' },
        ],
        [{ text: '🔙 Conexão', callback_data: 'wadv:connect' }],
        [{ text: '🚀 Painel Div', callback_data: 'wadv:home' }],
    ]);
}

function connectedSuccessKeyboard() {
    return Markup.inlineKeyboard([
        [{ text: '🚀 Abrir painel Div', callback_data: 'wadv:home' }],
        [{ text: '📣 Campanhas', callback_data: 'wadv:campaigns' }],
        [{ text: '🏠 Menu', callback_data: CB.MENU_HOME }],
    ]);
}

function campaignDoneKeyboard() {
    return Markup.inlineKeyboard([
        [{ text: '📣 Nova campanha', callback_data: 'wadv:campaigns' }],
        [
            { text: '📱 Meu WhatsApp', callback_data: 'wadv:my_wa' },
            { text: '📋 Histórico', callback_data: 'wadv:history' },
        ],
        [{ text: '🏠 Painel Div', callback_data: 'wadv:home' }],
    ]);
}

module.exports = {
    plansKeyboard,
    activePanelKeyboard,
    connectChoiceKeyboard,
    stubBackKeyboard,
    postPaymentKeyboard,
    phonePromptKeyboard,
    pairingFlowKeyboard,
    qrFlowKeyboard,
    connectedSuccessKeyboard,
    formatPairCodeForCopy,
    pairCopyButton,
    campaignDoneKeyboard,
};
