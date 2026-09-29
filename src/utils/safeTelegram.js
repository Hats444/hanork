'use strict';

const logger = require('../config/logger');

/** Telegram rejeita toast com surrogates inválidos (nomes de grupo WA corrompidos). */
function sanitizeCbQueryText(text) {
    if (text == null || text === '') return text;
    try {
        return Buffer.from(String(text), 'utf8')
            .toString('utf8')
            .replace(/\uFFFD/g, '')
            .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
            .slice(0, 200);
    } catch {
        return 'OK';
    }
}

function isCallbackCtx(ctx) {
    if (!ctx?.callbackQuery?.id) return false;
    if (ctx._refChannelSynthetic) return false;
    if (typeof ctx.answerCbQuery !== 'function') return false;
    if (ctx.updateType && ctx.updateType !== 'callback_query') return false;
    return true;
}

async function safeAnswerCbQuery(ctx, text, opts = {}) {
    if (!isCallbackCtx(ctx)) return;
    const safeText = text != null && text !== '' ? sanitizeCbQueryText(text) : text;
    try {
        await ctx.answerCbQuery(safeText, opts);
    } catch (error) {
        const msg = String(error.message || '');
        if (
            /query is too old|response timeout expired|query ID is invalid/i.test(msg) ||
            /answerCbQuery.*isn't available/i.test(msg)
        ) {
            return;
        }
        logger.warn('[safeTelegram] answerCbQuery', {
            message: error.message,
            callback: ctx.callbackQuery?.data,
            userId: ctx.from?.id,
        });
    }
}

module.exports = { safeAnswerCbQuery };
