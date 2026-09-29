'use strict';

const logger = require('../config/logger');

/** Registra tentativa sem permissão — não envia mensagem ao usuário. */
function denySilent(scope, ctx, extra = {}) {
    logger.info('[Access] negado silenciado', {
        scope: scope || 'unknown',
        uid: ctx?.from?.id,
        chatId: ctx?.chat?.id ?? ctx?.callbackQuery?.message?.chat?.id,
        callback: ctx?.callbackQuery?.data,
        command: ctx?.message?.text?.split?.(/\s+/)?.[0],
        ...extra,
    });
}

/** Callback sem admin — só log + dismiss silencioso (sem alerta). */
async function denyCbSilent(scope, ctx, extra = {}) {
    denySilent(scope, ctx, extra);
    try {
        await ctx.answerCbQuery?.();
    } catch {
        /* ignore */
    }
}

module.exports = { denySilent, denyCbSilent };
