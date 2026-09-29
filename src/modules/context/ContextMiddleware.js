'use strict';

const tenantContext = require('../../infrastructure/TenantContext');
const IntentEngine = require('./IntentEngine');
const ContextLogger = require('./ContextLogger');
const { isSlashCommandMessage } = require('../../telegram/freshUi');

let _engine = null;

function isLayerEnabled() {
    return process.env.CONTEXT_LAYER_ENABLED !== 'false';
}

function shouldReplySuggestions() {
    return process.env.CONTEXT_REPLY_SUGGESTIONS !== 'false';
}

/**
 * Verifica modos ativos que não devem passar pela camada contextual.
 */
async function shouldSkipContext(ctx, deps = {}) {
    if (!isLayerEnabled()) return { skip: true, reason: 'disabled' };
    if (!ctx.message?.text) return { skip: true, reason: 'no_text' };
    if (ctx.callbackQuery) return { skip: true, reason: 'callback' };
    if (ctx.chat?.type !== 'private') return { skip: true, reason: 'not_private' };

    const txt = ctx.message.text || '';
    if (isSlashCommandMessage(ctx) || txt.startsWith('/')) {
        return { skip: true, reason: 'command' };
    }

    const uid = ctx.from?.id;
    if (!uid) return { skip: true, reason: 'no_user' };

    const { isAdmin, isContextOperator } = deps;
    const allowed =
        typeof isContextOperator === 'function'
            ? isContextOperator(ctx)
            : isAdmin?.(uid) || tenantContext.isAdmin(uid);
    if (!allowed) return { skip: true, reason: 'not_operator' };

    const {
        productWizard,
        supportMode,
        hanorkAssistMode,
        editProductMode,
        broadcastMode,
        adminMsgTarget,
        campanhaEmailMode,
        catalogSearchMode,
        activeChats,
        joinChatAwaiting,
        isOnboarding,
    } = deps;

    if (joinChatAwaiting?.has?.(uid)) return { skip: true, reason: 'join_chat' };
    if (deps.bridgeLogin?.isAwaiting?.(uid)) return { skip: true, reason: 'bridge_login' };
    if (isOnboarding?.(uid)) return { skip: true, reason: 'onboarding' };
    if (productWizard?.has?.(uid)) return { skip: true, reason: 'product_wizard' };
    if (await hanorkAssistMode?.has?.(ctx.chat.id)) return { skip: true, reason: 'hanork_assist' };
    if (await supportMode?.has?.(ctx.chat.id)) return { skip: true, reason: 'support' };
    if (await editProductMode?.has?.(uid)) return { skip: true, reason: 'edit_product' };
    if (await broadcastMode?.has?.(uid)) return { skip: true, reason: 'broadcast' };
    if (await adminMsgTarget?.has?.(uid)) return { skip: true, reason: 'admin_msg' };
    if (await campanhaEmailMode?.has?.(uid)) return { skip: true, reason: 'email_mode' };
    if (catalogSearchMode?.has?.(uid)) return { skip: true, reason: 'catalog_search' };
    try {
        const { hasVirtuoSearch } = require('../virtuo/state/virtuoSearchMode');
        if (hasVirtuoSearch(uid)) return { skip: true, reason: 'virtuo_search' };
    } catch {
        /* ignore */
    }
    if (await activeChats?.get?.(ctx.chat.id)) return { skip: true, reason: 'ticket_chat' };

    if (deps.stateManager) {
        try {
            const { smmWizardOwnsFlow } = require('../smm/smmWizardGuard');
            if (await smmWizardOwnsFlow(ctx, deps.stateManager)) {
                return { skip: true, reason: 'smm_wizard' };
            }
        } catch {
            /* ignore */
        }
    }

    return { skip: false };
}

function getEngine(deps) {
    if (!_engine) {
        _engine = new IntentEngine({
            stateManager: deps.stateManager,
            dbRaw: deps.dbRaw,
            getCorrelationId: deps.getCorrelationId,
        });
    }
    return _engine;
}

/**
 * Processa mensagem operacional (não bloqueia fluxo principal).
 * @returns {{ processed: boolean, suggestReply?: string }}
 */
async function tryProcessOperationalMessage(ctx, deps = {}) {
    const gate = await shouldSkipContext(ctx, deps);
    if (gate.skip) {
        if (gate.reason !== 'disabled' && gate.reason !== 'not_operator') {
            ContextLogger.ignored({ reason: gate.reason, uid: ctx.from?.id });
        }
        return { processed: false, skipped: true, reason: gate.reason };
    }

    const tenantId = tenantContext.getCurrentNumericId() ?? 0;
    const text = ctx.message.text;

    try {
        const engine = getEngine(deps);
        const result = await engine.process({
            text,
            tenantId,
            operatorId: ctx.from.id,
            source: 'telegram',
        });

        if (!result.ok) return { processed: false, error: result.error };

        const suggest = result.routed?.suggestReply;
        const action = result.scored?.action;
        if (suggest && shouldReplySuggestions() && (action === 'suggest' || action === 'execute')) {
            return { processed: true, suggestReply: suggest, result };
        }
        return { processed: true, result };
    } catch (e) {
        ContextLogger.parseError(e, { uid: ctx.from?.id });
        return { processed: false, error: e.message };
    }
}

/**
 * Middleware Telegraf opcional — fire-and-forget; sempre chama next().
 */
function createContextMiddleware(deps) {
    return async function contextMiddleware(ctx, next) {
        if (!isLayerEnabled() || !ctx.message?.text) return next();

        const gate = await shouldSkipContext(ctx, deps);
        if (gate.skip) return next();

        setImmediate(() => {
            tryProcessOperationalMessage(ctx, deps).catch((e) => {
                ContextLogger.parseError(e, { phase: 'middleware' });
            });
        });

        return next();
    };
}

module.exports = {
    createContextMiddleware,
    shouldSkipContext,
    tryProcessOperationalMessage,
    isLayerEnabled,
};
