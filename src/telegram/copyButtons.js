'use strict';

function normalizeDigits(text) {
    return String(text || '').replace(/\D/g, '');
}

function phoneCopyText(phone) {
    const digits = normalizeDigits(phone);
    if (!digits) return '';
    return `+${digits}`;
}

/**
 * Botão inline que copia para a área de transferência (Bot API copy_text).
 * @param {string} label
 * @param {string} text
 * @returns {{ text: string, copy_text: { text: string } } | null}
 */
function buildCopyTextButton(label, text) {
    const value = String(text || '').trim();
    if (!value) return null;
    return {
        text: String(label || 'Copiar'),
        copy_text: { text: value },
    };
}

function buildPhoneCopyButton(label, phone) {
    const value = phoneCopyText(phone) || String(phone || '').trim();
    return buildCopyTextButton(label || '📋 Copiar número', value);
}

module.exports = {
    normalizeDigits,
    phoneCopyText,
    buildCopyTextButton,
    buildPhoneCopyButton,
};
