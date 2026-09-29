'use strict';

/**
 * Mascaramento para mensagens públicas (canais/grupos de referência).
 * Não altera dados persistidos — apenas camada de exibição.
 * Logs administrativos internos devem usar { public: false } ou não chamar esta função.
 */

function hashSuffix(value, len = 4) {
    const s = String(value ?? '').replace(/\D/g, '');
    if (!s) return '????';
    const tail = s.slice(-Math.min(len, s.length)).toUpperCase();
    return tail.padStart(len, '0').slice(-len);
}

function maskTelegramId(id) {
    return `Cliente #${hashSuffix(id, 4)}`;
}

function maskAffiliateCode() {
    return 'Afiliado Verificado';
}

function maskOrderId(orderId) {
    const s = String(orderId || '').trim();
    if (!s) return 'Pedido #????';
    if (/^[0-9a-f-]{32,36}$/i.test(s)) return `Pedido #${s.replace(/-/g, '').slice(-4).toUpperCase()}`;
    if (s.length >= 8) return `Pedido #${s.slice(-4).toUpperCase()}`;
    return `Pedido #${hashSuffix(s, 4)}`;
}

function maskUuid(uuid) {
    const s = String(uuid || '').trim();
    if (s.length >= 8) return `Pedido #${s.replace(/-/g, '').slice(-4).toUpperCase()}`;
    return `Pedido #${hashSuffix(s, 4)}`;
}

/**
 * @param {string} text
 * @param {{ public?: boolean }} [opts]
 * @returns {string}
 */
function maskSensitiveData(text, opts = {}) {
    if (!opts.public) return String(text ?? '');
    let s = String(text ?? '');

    // Links diretos com ID Telegram
    s = s.replace(/tg:\/\/user\?id=\d+/gi, 'https://t.me/');
    s = s.replace(/https:\/\/t\.me\/c\/\d+\/\d+/gi, '[link interno]');

    // UUIDs completos
    s = s.replace(
        /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
        (m) => maskUuid(m)
    );

    // Códigos de afiliado (AFF*, ref_* em code)
    s = s.replace(/<code>\s*(AFF[A-Z0-9]{3,20})\s*<\/code>/gi, `<code>${maskAffiliateCode()}</code>`);
    s = s.replace(/<code>\s*(ref_[A-Za-z0-9_-]+)\s*<\/code>/gi, `<code>${maskAffiliateCode()}</code>`);
    s = s.replace(/\bAFF[A-Z0-9]{3,20}\b/gi, maskAffiliateCode());

    // IDs Telegram / internos em <code>
    s = s.replace(/<code>\s*(\d{6,15})\s*<\/code>/gi, (_, id) => `<code>${maskTelegramId(id)}</code>`);
    s = s.replace(/<code>\s*#?([0-9a-f]{8,})\s*<\/code>/gi, (_, id) => {
        const masked = maskOrderId(id);
        return `<code>${masked.replace(/^Pedido\s*/i, '')}</code>`;
    });

    // IDs soltos (9+ dígitos — evita datas e valores pequenos)
    s = s.replace(/(?<![R$#/\d.])(\d{9,15})(?!\d)/g, (m) => maskTelegramId(m));

    // Histórico acumulado de gastos do cliente
    s = s.replace(
        /\d+\s*compra[s]?[^<\n]*·\s*<b>R\$[^<]+<\/b>([^<\n]*desde[^<\n]*)?/gi,
        'Cliente verificado'
    );
    s = s.replace(/🗄\s*<b>ID interno:<\/b>\s*<code>[^<]+<\/code>/gi, '');
    s = s.replace(/🆔\s*<b>Telegram ID:<\/b>\s*<code>[^<]+<\/code>/gi, `👤 <b>Cliente:</b> ${maskTelegramId('0').replace('#0000', '#????')}`);

    // IDs de fornecedor SMM
    s = s.replace(/Fornecedor\s*<code>[^<]+<\/code>/gi, 'Fornecedor verificado');

    // Pedido com hash longo fora de code
    s = s.replace(/\bPedido\s*#([0-9a-f]{8,})\b/gi, (_, id) => maskOrderId(id));
    s = s.replace(/\b#([0-9a-f]{8,})\b/gi, (_, id) => maskOrderId(id));

    // Payloads /start sensíveis
    s = s.replace(/📎\s*<b>(?:Link \/start|Payload afiliado):<\/b>\s*<code>[^<]+<\/code>/gi, '📎 <b>Origem:</b> link direto');

    return s.trim();
}

/** Atalho para mensagens de canal/grupo público */
function forPublicChannel(text) {
    return maskSensitiveData(text, { public: true });
}

module.exports = {
    maskSensitiveData,
    forPublicChannel,
    maskTelegramId,
    maskAffiliateCode,
    maskOrderId,
    maskUuid,
    hashSuffix,
};
