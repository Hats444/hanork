'use strict';

/** Códigos internos de violação */
const Violation = {
    COOLDOWN: 'COOLDOWN',
    RATE_1S: 'RATE_1S',
    RATE_5S: 'RATE_5S',
    RATE_30S: 'RATE_30S',
    DUPLICATE_TEXT: 'DUPLICATE_TEXT',
    CALLBACK_FLOOD: 'CALLBACK_FLOOD',
    MANUAL: 'MANUAL',
    BLACKLIST: 'BLACKLIST',
};

const LABELS = {
    [Violation.COOLDOWN]: 'mensagens enviadas em sequência muito rápida',
    [Violation.RATE_1S]: 'volume excessivo de mensagens por segundo',
    [Violation.RATE_5S]: 'volume excessivo de mensagens em poucos segundos',
    [Violation.RATE_30S]: 'uso intensivo do bot em curto período',
    [Violation.DUPLICATE_TEXT]: 'repetição da mesma mensagem várias vezes',
    [Violation.CALLBACK_FLOOD]: 'cliques repetidos em botões do menu',
    [Violation.MANUAL]: 'decisão da moderação da loja',
    [Violation.BLACKLIST]: 'reincidência grave após várias penalidades',
};

function formatDuration(seconds) {
    const s = Math.max(1, Math.ceil(Number(seconds) || 1));
    if (s >= 86400) {
        const d = Math.ceil(s / 86400);
        return d === 1 ? '1 dia' : `${d} dias`;
    }
    if (s >= 3600) {
        const h = Math.ceil(s / 3600);
        return h === 1 ? '1 hora' : `${h} horas`;
    }
    if (s >= 60) {
        const m = Math.ceil(s / 60);
        return m === 1 ? '1 minuto' : `${m} minutos`;
    }
    return s === 1 ? '1 segundo' : `${s} segundos`;
}

function formatRemaining(expiryMs) {
    if (!expiryMs) return null;
    const sec = Math.max(1, Math.ceil((expiryMs - Date.now()) / 1000));
    return formatDuration(sec);
}

function supportLine() {
    const url = process.env.CONTATO_ESPECIALISTA || process.env.SUPPORT_URL;
    if (url) return `\n\n📩 Dúvidas ou recurso: <a href="${url}">falar com o suporte</a>`;
    return '\n\n📩 Em caso de engano, fale com o suporte da loja informando seu ID do Telegram.';
}

/**
 * @param {object} opts
 * @param {string} opts.violation
 * @param {number} [opts.strike]
 * @param {number} [opts.durationSec]
 * @param {string} [opts.remaining]
 */
function buildTempBanMessage({ violation, strike = 1, durationSec = 30, remaining }) {
    const motivo = LABELS[violation] || LABELS[Violation.RATE_5S];
    const tempo = remaining || formatDuration(durationSec);
    return (
        `🛡️ <b>Acesso temporariamente limitado</b>\n\n` +
        `<b>Motivo:</b> ${motivo}.\n` +
        `<b>Penalidade:</b> ${strike}ª ocorrência — aguarde <b>${tempo}</b> para usar o bot normalmente.\n\n` +
        `<i>Evite enviar várias mensagens ou clicar botões em rajada. Compras e suporte continuam disponíveis após o prazo.</i>` +
        supportLine()
    );
}

function buildWarningMessage({ violation, strikesLeft }) {
    const motivo = LABELS[violation] || 'uso acelerado do bot';
    return (
        `⚠️ <b>Atenção — uso acelerado</b>\n\n` +
        `Detectamos ${motivo}.\n\n` +
        `Esta é uma <b>advertência</b>. Se continuar, sua conta será bloqueada temporariamente` +
        (strikesLeft > 0 ? ` (restam ${strikesLeft} advertência(s) antes do bloqueio).` : '.') +
        `\n\n<i>Use o menu com calma; não é necessário enviar a mesma mensagem várias vezes.</i>`
    );
}

function buildCooldownMessage(retryAfterMs) {
    const sec = Math.max(1, Math.ceil(retryAfterMs / 1000));
    return (
        `⏳ <b>Um momento</b>\n\n` +
        `Aguarde <b>${formatDuration(sec)}</b> antes de enviar outra mensagem.\n\n` +
        `<i>Isso não é um bloqueio — apenas evita envios acidentais em duplicidade.</i>`
    );
}

function buildStillBannedMessage({ violation, remaining, strike }) {
    const motivo = LABELS[violation] || 'limite de uso excedido';
    return (
        `🚫 <b>Você ainda está com acesso limitado</b>\n\n` +
        `<b>Motivo:</b> ${motivo}.\n` +
        (strike ? `<b>Ocorrência:</b> ${strike}ª penalidade.\n` : '') +
        `<b>Liberação em:</b> <b>${remaining}</b>\n\n` +
        `<i>Novas mensagens não aceleram a liberação. Aguarde o prazo indicado.</i>` +
        supportLine()
    );
}

function buildBlacklistMessage() {
    return (
        `🚫 <b>Acesso permanentemente restrito</b>\n\n` +
        `<b>Motivo:</b> ${LABELS[Violation.BLACKLIST]}.\n\n` +
        `Por segurança da loja e dos clientes, este perfil não pode mais utilizar o bot.` +
        supportLine()
    );
}

function buildManualBanMessage(reason) {
    const r = reason && String(reason).trim() ? String(reason).trim() : LABELS[Violation.MANUAL];
    return (
        `🚫 <b>Conta suspensa pela moderação</b>\n\n` +
        `<b>Motivo:</b> ${r}.\n\n` +
        `Se acredita que houve engano, entre em contato com o suporte com seu ID do Telegram.` +
        supportLine()
    );
}

function logReason(violation) {
    return LABELS[violation] || violation;
}

module.exports = {
    Violation,
    LABELS,
    formatDuration,
    formatRemaining,
    buildTempBanMessage,
    buildWarningMessage,
    buildCooldownMessage,
    buildStillBannedMessage,
    buildBlacklistMessage,
    buildManualBanMessage,
    logReason,
};
