'use strict';

/** Códigos oficiais Virtuo API v1 — README fonte única da verdade. */
const VIRTUO_ERROR_CODES = Object.freeze([
    'BAD_KEY',
    'KEY_REVOKED',
    'KEY_EXPIRED',
    'API_ACCESS_BLOCKED',
    'IP_BANNED',
    'RATE_LIMITED',
    'INSUFFICIENT_BALANCE',
    'INVALID_PARAMS',
    'NOT_FOUND',
    'NO_NUMBERS',
    'CANCEL_TOO_EARLY',
    'CANCEL_TOO_LATE',
    'SERVICE_UNAVAILABLE',
]);

const USER_MESSAGES = Object.freeze({
    BAD_KEY: 'Serviço temporariamente indisponível. Tente mais tarde.',
    KEY_REVOKED: 'Serviço temporariamente indisponível. Tente mais tarde.',
    KEY_EXPIRED: 'Serviço temporariamente indisponível. Tente mais tarde.',
    API_ACCESS_BLOCKED: 'Serviço temporariamente indisponível. Tente mais tarde.',
    IP_BANNED: 'Serviço temporariamente indisponível. Tente mais tarde.',
    RATE_LIMITED: 'Muitas tentativas — aguarde um minuto e tente de novo.',
    INSUFFICIENT_BALANCE: 'Sem estoque no provedor no momento — escolha outro país.',
    INVALID_PARAMS: 'Parâmetros inválidos — volte ao catálogo e escolha novamente.',
    NOT_FOUND: 'Pedido ou recurso não encontrado na API.',
    NO_NUMBERS: 'Nenhum número disponível agora — escolha outro país ou tente mais tarde.',
    CANCEL_TOO_EARLY: 'Aguarde 2 minutos após receber o número para cancelar.',
    CANCEL_TOO_LATE: 'Tempo máximo para cancelar expirou (30 minutos).',
    SERVICE_UNAVAILABLE: 'Servidor Virtuo indisponível — tente novamente em instantes.',
    NETWORK: 'Falha de conexão com a API Virtuo. Tente novamente.',
    PRICES_UNAVAILABLE: 'Não foi possível consultar preços agora. Tente de novo.',
    HTTP_ERROR: 'Erro temporário na API Virtuo.',
});

function normalizeErrorCode(error) {
    const raw = String(error?.code || error?.message || '').trim().toUpperCase();
    if (!raw) return 'UNKNOWN';
    if (VIRTUO_ERROR_CODES.includes(raw)) return raw;
    if (/NO_NUMBERS|OUT_OF_STOCK|UNAVAILABLE/.test(raw)) return 'NO_NUMBERS';
    if (/RATE.?LIMIT/.test(raw)) return 'RATE_LIMITED';
    if (/INSUFFICIENT|BALANCE/.test(raw)) return 'INSUFFICIENT_BALANCE';
    return raw;
}

function userMessageForError(error) {
    const code = normalizeErrorCode(error);
    return USER_MESSAGES[code] || USER_MESSAGES[error?.code] || 'Não foi possível concluir. Tente novamente.';
}

function mapErrorToFailureReason(error) {
    const code = normalizeErrorCode(error);
    switch (code) {
        case 'NO_NUMBERS':
        case 'NOT_FOUND':
            return 'out_of_stock';
        case 'INSUFFICIENT_BALANCE':
            return 'insufficient_provider_balance';
        case 'SERVICE_UNAVAILABLE':
        case 'NETWORK':
        case 'RATE_LIMITED':
            return 'provider_unavailable';
        case 'INVALID_PARAMS':
            return 'invalid_params';
        case 'CANCEL_TOO_EARLY':
        case 'CANCEL_TOO_LATE':
            return 'cancel_rejected';
        default:
            return 'provider_rejected';
    }
}

function isRetryableError(error) {
    const code = normalizeErrorCode(error);
    return code === 'RATE_LIMITED' || code === 'SERVICE_UNAVAILABLE' || code === 'NETWORK';
}

module.exports = {
    VIRTUO_ERROR_CODES,
    USER_MESSAGES,
    normalizeErrorCode,
    userMessageForError,
    mapErrorToFailureReason,
    isRetryableError,
};
