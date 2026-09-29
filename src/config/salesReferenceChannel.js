'use strict';

/** Canal @hanorkinfos — referências de venda + entrada obrigatória para usar o bot. */
const DEFAULT_SALES_REF_CHANNEL_ID = '-1004426605532';
const DEFAULT_SALES_REF_CHANNEL_LINK = 'https://t.me/hanorkinfos';

function getSalesRefChannelId() {
    const raw =
        process.env.SALES_REF_CHANNEL_ID ||
        process.env.HANORK_REF_CHANNEL_ID ||
        DEFAULT_SALES_REF_CHANNEL_ID;
    const v = String(raw || '').trim().toLowerCase();
    if (!v || v === '0' || v === 'false' || v === 'off' || v === 'disabled') return null;
    return String(raw).trim();
}

function isSalesRefChannel(chatId) {
    const ref = getSalesRefChannelId();
    if (!ref || chatId == null) return false;
    return String(chatId) === String(ref);
}

function isSalesRefChannelEnabled() {
    return !!getSalesRefChannelId();
}

function getSalesRefChannelUrl() {
    const raw =
        process.env.SALES_REF_CHANNEL_LINK ||
        process.env.HANORK_REF_CHANNEL_LINK ||
        DEFAULT_SALES_REF_CHANNEL_LINK;
    const v = String(raw || '').trim();
    if (!v || v === '0' || v === 'false' || v === 'off') {
        return DEFAULT_SALES_REF_CHANNEL_LINK;
    }
    return v;
}

/** 1 = usuário precisa estar inscrito no canal para usar o bot (padrão). */
function isRefChannelRequired() {
    if (!isSalesRefChannelEnabled()) return false;
    const raw = process.env.REF_CHANNEL_REQUIRED ?? process.env.HANORK_REF_REQUIRED ?? '1';
    const v = String(raw).trim().toLowerCase();
    return v !== '0' && v !== 'false' && v !== 'off' && v !== 'no';
}

function _envFlagEnabled(raw, defaultOn = true) {
    const v = String(raw ?? (defaultOn ? '1' : '0')).trim().toLowerCase();
    return v !== '0' && v !== 'false' && v !== 'off' && v !== 'no';
}

/** 1 = detecta entrada no canal via chat_member e libera automaticamente (padrão). */
function isRefChannelAutoVerifyEnabled() {
    if (!isRefChannelRequired()) return false;
    return _envFlagEnabled(process.env.REF_CHANNEL_AUTO_VERIFY ?? '1', true);
}

/** 1 = mantém botão «Verificar entrada» no painel (padrão). */
function isRefChannelManualVerifyEnabled() {
    if (!isRefChannelRequired()) return false;
    return _envFlagEnabled(process.env.REF_CHANNEL_MANUAL_VERIFY ?? '1', true);
}

/** Rótulos unificados — menu, botões e textos (sem «Grupo VIP»). */
const CHANNEL_UI = {
    menu: '📢 Referências',
    menuLegacy: '📢 Referências',
    button: '📢 Entrar no canal',
    verify: '✅ Verificar entrada',
    title: 'Canal de referências',
};

/** HTML — vantagens liberadas após entrar no canal (reutilizado em gate, downloads, boas-vindas). */
function buildChannelUnlockBenefitsHtml() {
    const dlLimit = Math.max(1, Number(process.env.DOWNLOADS_DAILY_LIMIT) || 100);
    return (
        '<b>O que você libera ao entrar:</b>\n' +
        '🛒 <b>Loja Hanork</b> — catálogo, carrinho e checkout\n' +
        '⬇️ <b>Downloads</b> — YouTube, TikTok, Instagram e música no PV\n' +
        `   <i>até ${dlLimit} downloads por dia</i>\n` +
        '👤 <b>Minha conta</b> — pedidos, saldo, carteira e afiliado\n' +
        '📈 <b>Serviços SMM</b> — seguidores, views e engajamento\n' +
        '📲 <b>Hanork Div</b> — divulgação no seu WhatsApp <i>(plano pago)</i>\n' +
        '🔔 <b>Ofertas e novidades</b> — promoções antes de todo mundo\n\n' +
        '<i>É gratuito — só precisa estar inscrito no canal para usar o bot.</i>'
    );
}

module.exports = {
    DEFAULT_SALES_REF_CHANNEL_ID,
    DEFAULT_SALES_REF_CHANNEL_LINK,
    CHANNEL_UI,
    buildChannelUnlockBenefitsHtml,
    getSalesRefChannelId,
    getSalesRefChannelUrl,
    isSalesRefChannel,
    isSalesRefChannelEnabled,
    isRefChannelRequired,
    isRefChannelAutoVerifyEnabled,
    isRefChannelManualVerifyEnabled,
};
