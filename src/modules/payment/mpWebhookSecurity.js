'use strict';

/**
 * Validação de segurança para webhooks Mercado Pago (IP + HMAC).
 * Extraído de bot.js para testabilidade — lógica idêntica à original.
 */
const crypto = require('crypto');
const logger = require('../../config/logger');

// Fonte: https://www.mercadopago.com.br/developers/pt/docs/notifications/webhooks
const MP_IP_RANGES_PROD = [
    '200.80.', '200.24.', '186.64.', '190.232.',
    '::ffff:200.80.', '::ffff:200.24.',
];

function isMpIp(req) {
    if (process.env.NODE_ENV !== 'production') return true;
    if (process.env.MP_SKIP_IP_CHECK === 'true') {
        logger.warn('[WEBHOOK] MP_SKIP_IP_CHECK ativo — não use em produção real');
        return true;
    }
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || '';
    if (!ip) return false;
    return MP_IP_RANGES_PROD.some((prefix) => ip.startsWith(prefix));
}

function validateMpSignature(req) {
    const secret = (process.env.MP_WEBHOOK_SECRET || '').trim();
    const isProd = process.env.NODE_ENV === 'production';

    if (!secret) {
        if (isProd && process.env.MP_ALLOW_UNSIGNED_WEBHOOK !== 'true') {
            logger.warn('[WEBHOOK] MP_WEBHOOK_SECRET ausente em produção — rejeitando (defina secret ou MP_ALLOW_UNSIGNED_WEBHOOK=true só em teste)');
            return false;
        }
        return true;
    }

    const xSig = req.headers['x-signature'];
    const xReqId = req.headers['x-request-id'];
    if (!xSig || !xReqId) {
        if (!isProd && req.body?.live_mode === false) return true;
        return false;
    }
    const [, ts] = (xSig.match(/ts=(\d+)/) || []);
    const [, v1] = (xSig.match(/v1=([a-f0-9]+)/) || []);
    if (!ts || !v1) return false;
    const dataId = req.body?.data?.id || '';
    const manifest = `id:${dataId};request-id:${xReqId};ts:${ts};`;
    const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
    if (v1.length !== expected.length || !/^[a-f0-9]+$/i.test(v1)) return false;
    const expectedBuf = Buffer.from(expected, 'hex');
    const v1Buf = Buffer.from(v1, 'hex');
    if (expectedBuf.length !== v1Buf.length) return false;
    return crypto.timingSafeEqual(expectedBuf, v1Buf);
}

module.exports = {
    MP_IP_RANGES_PROD,
    isMpIp,
    validateMpSignature,
};
