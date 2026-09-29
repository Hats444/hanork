'use strict';

const { escapeTelegramHtml } = require('../../../telegram/htmlEscape');

function formatMoney(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 'R$ 0,00';
    return `R$ ${n.toFixed(2).replace('.', ',')}`;
}

function formatQuoteBlock(svc, saleTotal) {
    return (
        `<b>📱 Número virtual — SMS</b>\n\n` +
        `<b>${escapeTelegramHtml(svc.service_name)}</b>\n` +
        `País: ${escapeTelegramHtml(svc.country_name)}\n` +
        `Valor: <b>${formatMoney(saleTotal)}</b>\n\n` +
        `<i>Após o pagamento você recebe o número e o código SMS aqui no Telegram.</i>`
    );
}

function formatPhone(phone) {
    return escapeTelegramHtml(String(phone || ''));
}

function formatSmsCode(code) {
    return escapeTelegramHtml(String(code || '').trim());
}

function apiErrorToUser(code) {
    const map = {
        INSUFFICIENT_BALANCE: 'Sem estoque no momento — escolha outro país.',
        NO_NUMBERS: 'Nenhum número disponível agora — tente outro país.',
        RATE_LIMITED: 'Muitas tentativas — aguarde um minuto.',
        BAD_KEY: 'Serviço temporariamente indisponível.',
        pending_activation: 'Você já tem uma ativação em andamento.',
    };
    return map[code] || 'Não foi possível concluir. Tente novamente.';
}

module.exports = {
    formatMoney,
    formatQuoteBlock,
    formatPhone,
    formatSmsCode,
    apiErrorToUser,
};
