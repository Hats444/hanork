'use strict';

const logger = require('../../config/logger');
const { normalizeCallbackData } = require('../callbacks/legacyPatterns');
const { safeAnswerCbQuery } = require('../../utils/safeTelegram');
const { navigationDebounceMs } = require('../../utils/navigationCallbackFilter');

function validationMiddleware() {
    return async (ctx, next) => {
        const raw = ctx.callbackQuery?.data;
        const n = normalizeCallbackData(raw);
        if (!n) {
            await safeAnswerCbQuery(ctx, '❌ Ação inválida');
            logger.warn('[CallbackPipeline] invalid', { raw, userId: ctx.from?.id });
            return false;
        }
        if (n !== raw) ctx.callbackQuery.data = n;
        return next();
    };
}

function debounceMiddleware(stateManager, adminIds = []) {
    return async (ctx, next) => {
        const uid = ctx.from?.id;
        const data = ctx.callbackQuery?.data || '';
        if (uid && adminIds.includes(uid)) {
            await safeAnswerCbQuery(ctx);
            return next();
        }
        if (/^payment:|^checkout:/.test(data)) {
            await safeAnswerCbQuery(ctx, '⏳ Processando...');
            return next();
        }
        const chatId = ctx.chat?.id;
        if (!chatId) return next();
        const lockMs = navigationDebounceMs(data);
        const key = `cb:${chatId}:${data}`;
        if (!stateManager.acquireLock(key, lockMs)) {
            await safeAnswerCbQuery(ctx, '⏳ Aguarde...');
            return false;
        }
        try {
            await safeAnswerCbQuery(ctx);
            return await next();
        } finally {
            stateManager.releaseLock(key);
        }
    };
}

function auditMiddleware() {
    return async (ctx, next) => {
        const t0 = Date.now();
        const data = ctx.callbackQuery?.data;
        logger.info('[CallbackPipeline] start', { data, userId: ctx.from?.id });
        try {
            const r = await next();
            logger.info('[CallbackPipeline] done', { data, ms: Date.now() - t0 });
            return r;
        } catch (e) {
            logger.error('[CallbackPipeline] error', { data, message: e.message, stack: e.stack });
            throw e;
        }
    };
}

module.exports = { validationMiddleware, debounceMiddleware, auditMiddleware };
