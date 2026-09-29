'use strict';

const logger = require('../../config/logger');
const { classifyTelegramUpdate } = require('../events/TelegramEventClassifier');
const { createTelegramEventAuditService } = require('../../services/TelegramEventAuditService');

function isEventDebugEnabled() {
    const v = String(process.env.TELEGRAM_EVENT_DEBUG || '0').trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes';
}

/**
 * Event Router — classifica todo update e grava auditoria no banco.
 * @param {{ dbRaw?: Function, deferBackground?: Function }} deps
 */
function createTelegramEventRouterMiddleware(deps = {}) {
    const { dbRaw, deferBackground } = deps;
    const auditService = typeof dbRaw === 'function' ? createTelegramEventAuditService(dbRaw) : null;

    function persistEvent(meta, ctx, { isDebug = false } = {}) {
        if (!auditService) return;

        const extra = {
            isDebug,
            routeExecuted: meta.skipUserPipeline ? 'system' : meta.route,
        };
        if (meta.eventType === 'callback_query') {
            extra.callbackData = String(ctx.callbackQuery?.data || '').slice(0, 80);
        }
        if (isDebug) {
            extra.routeExecuted = meta.skipUserPipeline ? 'system' : meta.route;
        }

        const runInsert = () => {
            try {
                auditService.insert(meta, extra);
            } catch (err) {
                logger.warn('[TelegramEvent] falha ao gravar auditoria no banco: ' + (err?.message || err));
            }
        };

        if (typeof deferBackground === 'function') {
            deferBackground('telegram-event-audit', runInsert);
        } else {
            runInsert();
        }
    }

    return async (ctx, next) => {
        const meta = classifyTelegramUpdate(ctx);
        ctx.telegramEvent = meta;

        const debug = isEventDebugEnabled();
        persistEvent(meta, ctx, { isDebug: debug });

        if (debug) {
            logger.info(
                `[TelegramEvent:DEBUG] type=${meta.eventType} route=${meta.skipUserPipeline ? 'system' : meta.route} chat=${meta.chatId} user=${meta.userId}`
            );
        }

        return next();
    };
}

module.exports = { createTelegramEventRouterMiddleware };
