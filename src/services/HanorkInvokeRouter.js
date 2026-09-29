'use strict';

const { ACTIONS, ROUTER_VERSION } = require('../config/hanork-ai-actions');
const COPY = require('../config/hanork-router-copy');
const HanorkIntentEngine = require('./hanork-ai/HanorkIntentEngine');
const HanorkRouterGuard = require('./hanork-ai/HanorkRouterGuard');
const HanorkActionExecutor = require('./hanork-ai/HanorkActionExecutor');
const HanorkLlmPlanner = require('./hanork-ai/HanorkLlmPlanner');
const HanorkRouterContext = require('./hanork-ai/HanorkRouterContext');
const NL = require('./hanork-ai/HanorkNlExtractors');
const aiSupport = require('../config/ai-support');

const LOG_PREFIX = '[HanorkRouter]';
const CLARIFY_TTL_MS = 10 * 60 * 1000;

function addressedToHanork(text, opts = {}) {
    if (typeof HanorkIntentEngine.isAddressedToHanork === 'function') {
        return HanorkIntentEngine.isAddressedToHanork(text, opts);
    }
    return !!opts.fromCommand || !!HanorkIntentEngine.hasHanorkMention?.(text);
}

async function replyConversationalAi(ctx, messageText, deps, options = {}) {
    const { Msg, logger, loadProducts } = deps;
    const intentText = HanorkIntentEngine.getIntentText(messageText, {
        fromCommand: !!options.fromCommand,
    });
    const text = String(intentText || messageText || '').trim();
    if (!text) {
        await Msg.reply(ctx, COPY.commandNotUnderstood, null, { parse_mode: 'HTML' });
        return;
    }

    if (!aiSupport.isEnabled()) {
        await Msg.reply(ctx, COPY.commandNotUnderstood, null, { parse_mode: 'HTML' });
        return;
    }

    let productCount = null;
    try {
        const products = await loadProducts?.();
        productCount = Array.isArray(products) ? products.length : null;
    } catch (_) {
        /* ignore */
    }

    await ctx.sendChatAction('typing').catch(() => {});
    const result = await aiSupport.processMessage(text, {
        firstName: ctx.from?.firstName,
        botName: process.env.BOT_DISPLAY_NAME || 'Hanork',
        shopTagline: process.env.BOT_SHOP_TAGLINE || 'Loja online',
        productCount,
    });

    const body = result?.response || COPY.commandNotUnderstood;
    logger?.info?.(`${LOG_PREFIX} conversational_ai`, {
        uid: ctx.from?.id,
        type: result?.type,
        len: text.length,
    });
    await Msg.reply(ctx, body, null, { parse_mode: 'HTML' });
}

/**
 * Hanork AI Router — linguagem natural → fluxos nativos (hanorkia v1.0).
 * Modo silencioso (action: none). Sem conversa contínua.
 */
async function tryHandle(ctx, rawText, deps, options = {}) {
    const {
        Msg,
        logger,
        commandLimiter,
        isAdmin,
        groupGuard,
        supportMode,
        activeChats,
        hanorkAssistMode,
    } = deps;

    try {
        return await tryHandleInner(ctx, rawText, deps, options);
    } catch (err) {
        logger?.error?.(`${LOG_PREFIX} fatal`, {
            uid: ctx.from?.id,
            message: err?.message,
            stack: err?.stack?.split?.('\n')?.[0],
        });
        return { handled: false };
    }
}

async function tryHandleInner(ctx, rawText, deps, options = {}) {
    const {
        Msg,
        logger,
        commandLimiter,
        isAdmin,
        groupGuard,
        supportMode,
        activeChats,
        hanorkAssistMode,
        hanorkRouterContext,
        editProductMode,
        broadcastMode,
        resolveSupportGroupId,
        bot,
    } = deps;

    const { fromCommand = false, commandArgs = '', escapeSupportMode = false } = options;
    const text = fromCommand ? commandArgs : rawText;
    const uid = ctx.from?.id;

    if (!fromCommand && uid && editProductMode && (await editProductMode.has(uid))) {
        return { handled: false };
    }
    if (!fromCommand && uid && deps.productWizard?.has?.(uid)) {
        return { handled: false };
    }

    if (!fromCommand && deps.stateManager) {
        try {
            const { shouldBlockHanorkIntent } = require('../modules/smm/smmWizardGuard');
            if (await shouldBlockHanorkIntent(ctx, deps.stateManager)) {
                return { handled: false };
            }
        } catch {
            /* ignore */
        }
    }

    const routerCtx = HanorkRouterGuard.getRouterContext(ctx, { resolveSupportGroupId });
    const { inPrivate, inGroup, inSupportGroup, inMemberRouter } = routerCtx;
    const sessionCtx = hanorkRouterContext
        ? await HanorkRouterContext.mergeActiveModes(ctx.chat.id, hanorkRouterContext, {
              uid,
              editProductMode,
              broadcastMode,
              getCart: deps.getCart,
          })
        : {};
    const classifyCtx = {
        isAdmin: isAdmin(uid),
        inPrivate,
        inGroup,
        inSupportGroup,
        inMemberRouter,
        routerContext: sessionCtx,
    };

    if (ctx.state?.hanorkDispatch) return { handled: false };

    if (!HanorkRouterGuard.isHanorkAllowedChat(ctx, resolveSupportGroupId)) {
        if (fromCommand) {
            await Msg.reply(ctx, COPY.supportGroupOnly, null, { parse_mode: 'HTML' });
            return { handled: true };
        }
        return { handled: false };
    }

    if (!fromCommand) {
        const ticket = await activeChats?.get?.(ctx.chat.id);
        if (ticket?.role === 'user') {
            const peek = HanorkIntentEngine.peekOperationalRoute(rawText, classifyCtx, {
                inPrivate,
                inGroup,
            });
            if (!peek.route) {
                return { handled: false };
            }
            logger.info(`${LOG_PREFIX} ticket_bypass`, {
                uid,
                action: peek.classification.action,
                pendingAction: peek.classification.pendingAction,
                ticketId: ticket.ticketId,
            });
        }
        if (!escapeSupportMode && (await supportMode?.has?.(ctx.chat.id))) {
            const preview = HanorkIntentEngine.classify(rawText, classifyCtx);
            if (
                HanorkIntentEngine.isOperationalAction(preview.action) &&
                HanorkIntentEngine.shouldActivate(rawText, preview, {
                    fromCommand: false,
                    inPrivate,
                    inGroup,
                })
                    .activate
            ) {
                await supportMode.delete(ctx.chat.id);
                logger.info(`${LOG_PREFIX} support_mode_cleared`, {
                    uid,
                    action: preview.action,
                });
            } else {
                return { handled: false };
            }
        }
    }

    const pending = await hanorkAssistMode?.get?.(ctx.chat.id);
    if (pending?.clarify && pending.pendingAction && !fromCommand) {
        const age = Date.now() - (pending._ts || 0);
        if (age > CLARIFY_TTL_MS) {
            await hanorkAssistMode.delete(ctx.chat.id).catch(() => {});
            logger?.info?.(`${LOG_PREFIX} clarify_expired`, { uid, pendingAction: pending.pendingAction });
        } else {
            return finishClarify(ctx, rawText, pending, deps);
        }
    }

    if (fromCommand) {
        const parsed = HanorkIntentEngine.parseCommandArgs(text);
        if (!parsed.ok) return { handled: false, openMenu: true };
    } else if (
        !addressedToHanork(rawText, { inPrivate, inGroup }) &&
        !(inPrivate && HanorkIntentEngine.hasImplicitBotAddress(rawText))
    ) {
        const preview = HanorkIntentEngine.classify(rawText, classifyCtx);
        const gate = HanorkIntentEngine.shouldActivate(rawText, preview, {
            fromCommand: false,
            inPrivate,
            inGroup,
        });
        if (!gate.activate) return { handled: false };
    }

    if (HanorkIntentEngine.hasHanorkMention(rawText) && !fromCommand) {
        const stripped = HanorkIntentEngine.stripHanorkAddress(rawText);
        if (!stripped) {
            return { handled: false, openMenu: true };
        }
    }

    if (uid && !isAdmin(uid) && commandLimiter) {
        const lim = commandLimiter.check(uid, '/hanork');
        if (!lim.allowed) {
            await Msg.reply(ctx, COPY.rateLimit(lim.retryAfter), null, { parse_mode: 'HTML' });
            return { handled: true };
        }
    }

    const sourceText = fromCommand ? text : rawText;
    const classifyText = HanorkIntentEngine.getIntentText(sourceText, { fromCommand });
    let classification = HanorkIntentEngine.classify(classifyText || sourceText, classifyCtx);
    if (sessionCtx && Object.keys(sessionCtx).length) {
        classification = HanorkRouterContext.enrichClassification(
            classifyText || sourceText,
            classification,
            sessionCtx,
            { isAdmin: classifyCtx.isAdmin }
        );
    }
    classification.sourceText = sourceText;

    if (
        classification.action === ACTIONS.RUN_SLASH &&
        HanorkIntentEngine.isHanorkMetaSlash(classification.params)
    ) {
        const tail = String(classification.params?.args || sourceText || '').trim();
        if (tail.length >= 2) {
            classification = HanorkIntentEngine.classify(tail, classifyCtx);
            if (sessionCtx && Object.keys(sessionCtx).length) {
                classification = HanorkRouterContext.enrichClassification(
                    tail,
                    classification,
                    sessionCtx,
                    { isAdmin: classifyCtx.isAdmin }
                );
            }
            classification.sourceText = tail;
            classification = HanorkIntentEngine.applyConfidencePolicy(classification, classifyCtx);
        } else {
            return { handled: false, openMenu: true };
        }
    }

    let gate = HanorkIntentEngine.shouldActivate(sourceText, classification, {
        fromCommand,
        inPrivate,
        inGroup,
    });

    const commandLlmFallback = HanorkIntentEngine.needsPlannerFallback(classification, {
        fromCommand,
        rawText: sourceText,
        inPrivate,
        inGroup,
    });

    if (
        !gate.activate ||
        commandLlmFallback ||
        (classifyCtx.isAdmin &&
            inPrivate &&
            classification.confidence < 80 &&
            classification.action !== ACTIONS.NONE &&
            classification.action !== ACTIONS.ASK)
    ) {
        const llmPlan = await HanorkLlmPlanner.plan(sourceText, classifyCtx, classification, {
            uid,
            fromCommand,
            inPrivate,
            inGroup,
            gate,
            routerContext: sessionCtx,
        });
        if (llmPlan?.action && llmPlan.action !== ACTIONS.NONE) {
            classification = { ...llmPlan, sourceText };
            if (sessionCtx && Object.keys(sessionCtx).length) {
                classification = HanorkRouterContext.enrichClassification(
                    sourceText,
                    classification,
                    sessionCtx,
                    { isAdmin: classifyCtx.isAdmin }
                );
            }
            classification = HanorkIntentEngine.applyConfidencePolicy(classification, classifyCtx);
            gate = HanorkLlmPlanner.resolveGateAfterPlan(sourceText, classification, {
                fromCommand,
                inPrivate,
                inGroup,
            });
            logger.info(`${LOG_PREFIX} llm_route`, {
                uid,
                action: classification.action,
                confidence: classification.confidence,
                gate: gate.reason,
                ask: classification.action === ACTIONS.ASK,
            });
        } else if (!gate.activate) {
            return { handled: false };
        }
    } else if (!gate.activate) {
        return { handled: false };
    }

    const actionCheck = HanorkRouterGuard.validateAction(classification.action, {
        inPrivate,
        isAdmin: isAdmin(uid),
        params: classification.params,
    });
    if (!actionCheck.allowed) {
        const msg =
            actionCheck.reason === 'admin_group' ? COPY.groupAdminPrivate : COPY.groupPrivateAction;
        if (actionCheck.redirectPrivate && groupGuard?.isGroupChat?.(ctx) && deps.bot) {
            await groupGuard.replyGroupRedirect(ctx, deps.bot, { body: msg, showAlert: true });
        } else {
            await Msg.reply(ctx, msg, null, { parse_mode: 'HTML' });
        }
        return { handled: true };
    }

    if (classification.action === ACTIONS.NONE) {
        const addressed = addressedToHanork(sourceText, {
            fromCommand,
            inPrivate,
            inGroup,
        });
        if (addressed) {
            await replyConversationalAi(ctx, sourceText, deps, { fromCommand });
            return { handled: true };
        }
        await Msg.reply(ctx, COPY.hintInvoke, null, { parse_mode: 'HTML' });
        return { handled: true };
    }

    if (classification.action === ACTIONS.ASK) {
        await hanorkAssistMode.set(ctx.chat.id, {
            clarify: true,
            pendingAction: classification.pendingAction,
            params: classification.params,
            sourceText,
            _ts: Date.now(),
        });
        await Msg.reply(ctx, classification.question, null, { parse_mode: 'HTML' });
        logger.info('[INTENT_AI] clarification requested', {
            uid,
            pendingAction: classification.pendingAction,
            confidence: classification.confidence,
            confirm: Boolean(classification.params?.confirmIntent),
        });
        return { handled: true };
    }

    if (classification.confidence < 70 && classification.action !== ACTIONS.NONE) {
        logger.info('[INTENT_AI] confidence low', {
            uid,
            action: classification.action,
            confidence: classification.confidence,
        });
    }

    logger.info('[INTENT_AI] intent resolved', {
        uid,
        action: classification.action,
        confidence: classification.confidence,
        gate: gate.reason,
        fromCommand,
        v: ROUTER_VERSION,
    });

    logger.info(`${LOG_PREFIX} route`, {
        uid,
        action: classification.action,
        confidence: classification.confidence,
        gate: gate.reason,
        fromCommand,
        v: ROUTER_VERSION,
    });

    if (hanorkRouterContext) {
        await HanorkRouterContext.recordIntent(ctx.chat.id, hanorkRouterContext, sourceText, classification);
    }

    await ctx.sendChatAction('typing').catch(() => {});
    const result = await HanorkActionExecutor.execute(ctx, classification, deps);
    if (hanorkRouterContext) {
        await HanorkRouterContext.recordResult(ctx.chat.id, hanorkRouterContext, classification, result);
    }
    if (result?.needsClarify) return { handled: false };
    if (result?.silent) return { handled: false };
    if (result?.ok === false) return { handled: false };
    return { handled: true };
}

async function finishClarify(ctx, replyText, pending, deps) {
    const { hanorkAssistMode, isAdmin, logger, Msg } = deps;
    const uid = ctx.from?.id;

    try {
        return await finishClarifyInner(ctx, replyText, pending, deps);
    } catch (err) {
        logger?.error?.(`${LOG_PREFIX} clarify_fatal`, {
            uid,
            message: err?.message,
        });
        await hanorkAssistMode?.delete?.(ctx.chat.id).catch(() => {});
        return { handled: false };
    }
}

async function finishClarifyInner(ctx, replyText, pending, deps) {
    const { hanorkAssistMode, isAdmin, logger, Msg } = deps;
    const uid = ctx.from?.id;
    const reply = String(replyText || '').trim();

    if (deps.stateManager) {
        try {
            const { smmWizardOwnsFlow } = require('../modules/smm/smmWizardGuard');
            if (await smmWizardOwnsFlow(ctx, deps.stateManager)) {
                return { handled: false };
            }
        } catch {
            /* ignore */
        }
    }

    if (pending.params?.confirmIntent && pending.pendingAction) {
        if (/^(?:sim|s|confirmo|confirmar|yes|ok)$/i.test(reply)) {
            await hanorkAssistMode.delete(ctx.chat.id);
            const exec = {
                action: pending.pendingAction,
                confidence: 95,
                params: { ...pending.params, confirmed: true },
                sourceText: pending.sourceText,
            };
            delete exec.params.confirmIntent;
            await ctx.sendChatAction('typing').catch(() => {});
            const result = await HanorkActionExecutor.execute(ctx, exec, deps);
            logger.info('[INTENT_AI] intent resolved', { uid, action: exec.action, via: 'confirm' });
            return { handled: result?.ok !== false };
        }
        if (/^(?:n[aã]o|nao|cancelar?|cancela)$/i.test(reply)) {
            await hanorkAssistMode.delete(ctx.chat.id);
            await Msg.reply(ctx, 'Ok, alteração cancelada.', null, { parse_mode: 'HTML' });
            return { handled: true };
        }
    }

    if (pending.pendingAction === ACTIONS.PRODUCT_EDIT_FIELD && pending.params?.field) {
        const value = String(reply || '').trim();
        if (value.length >= 2 && !/^(?:sim|n[aã]o|nao|cancelar?)$/i.test(value)) {
            await hanorkAssistMode.delete(ctx.chat.id);
            const exec = {
                action: ACTIONS.PRODUCT_EDIT_FIELD,
                confidence: 92,
                params: { ...pending.params, value },
                sourceText: pending.sourceText,
            };
            await ctx.sendChatAction('typing').catch(() => {});
            const result = await HanorkActionExecutor.execute(ctx, exec, deps);
            return { handled: result?.ok !== false };
        }
    }

    if (pending.pendingAction === ACTIONS.PRODUCT_EDIT_PRICE) {
        const price = NL.parseMoneyValue(reply);
        if (price != null) {
            await hanorkAssistMode.delete(ctx.chat.id);
            const exec = {
                action: ACTIONS.PRODUCT_EDIT_PRICE,
                confidence: 92,
                params: { ...pending.params, price },
                sourceText: pending.sourceText,
            };
            await ctx.sendChatAction('typing').catch(() => {});
            const result = await HanorkActionExecutor.execute(ctx, exec, deps);
            if (deps.hanorkRouterContext) {
                await HanorkRouterContext.recordResult(ctx.chat.id, deps.hanorkRouterContext, exec, result);
            }
            return { handled: result?.ok !== false };
        }
    }

    const inPrivate = deps.groupGuard?.isPrivateChat?.(ctx);
    const inGroup = deps.groupGuard?.isGroupChat?.(ctx);
    const routerStore = deps.hanorkRouterContext;
    const sessionCtx = routerStore
        ? await HanorkRouterContext.mergeActiveModes(ctx.chat.id, routerStore, {
              uid,
              editProductMode: deps.editProductMode,
              broadcastMode: deps.broadcastMode,
              getCart: deps.getCart,
          })
        : {};
    const inSupportGroup =
        deps.resolveSupportGroupId &&
        HanorkRouterGuard.isSupportGroupChat(ctx, deps.resolveSupportGroupId);
    const classifyCtx = {
        isAdmin: isAdmin(uid),
        inPrivate: !!inPrivate,
        inGroup: !!inGroup,
        inSupportGroup: !!inSupportGroup,
        inMemberRouter: !!inPrivate || !!inGroup,
        routerContext: sessionCtx,
    };

    const replyOnly = HanorkIntentEngine.classify(replyText, classifyCtx);
    const replyHasUrl = /https?:\/\//.test(String(replyText || ''));
    const pendingNeedsUrl =
        pending.pendingAction === ACTIONS.DOWNLOAD &&
        !pending.params?.url &&
        !pending.params?.tiktokQuery &&
        !pending.params?.instagramParsed &&
        !/https?:\/\//.test(String(pending.sourceText || ''));

    if (
        replyOnly.action !== ACTIONS.NONE &&
        replyOnly.action !== ACTIONS.ASK &&
        replyOnly.action !== pending.pendingAction &&
        !(pendingNeedsUrl && replyHasUrl)
    ) {
        const gate = HanorkIntentEngine.shouldActivate(replyText, replyOnly, {
            fromCommand: false,
            inPrivate: classifyCtx.inPrivate,
            inGroup: classifyCtx.inGroup,
        });
        if (gate.activate && (replyOnly.confidence >= 70 || HanorkIntentEngine.isOperationalAction(replyOnly.action))) {
            await hanorkAssistMode.delete(ctx.chat.id);
            logger.info(`${LOG_PREFIX} clarify_cancel`, {
                uid,
                was: pending.pendingAction,
                now: replyOnly.action,
            });
            replyOnly.sourceText = replyText;
            await ctx.sendChatAction('typing').catch(() => {});
            const result = await HanorkActionExecutor.execute(ctx, replyOnly, deps);
            return { handled: result?.ok !== false };
        }
    }

    if (pendingNeedsUrl && !replyHasUrl && replyOnly.action === ACTIONS.NONE) {
        await hanorkAssistMode.delete(ctx.chat.id);
        await Msg.reply(
            ctx,
            'Sem link na mensagem — cancelado. Cole o link ou peça de novo (ex.: <i>baixa esse reel</i> + link).',
            null,
            { parse_mode: 'HTML' }
        );
        return { handled: true };
    }

    await hanorkAssistMode.delete(ctx.chat.id);

    const mergedText = `${pending.sourceText || ''} ${replyText}`.trim();
    let classification = HanorkIntentEngine.classify(mergedText, classifyCtx);
    if (sessionCtx && Object.keys(sessionCtx).length) {
        classification = HanorkRouterContext.enrichClassification(
            mergedText,
            classification,
            sessionCtx,
            { isAdmin: classifyCtx.isAdmin }
        );
    }

    classification.action = pending.pendingAction;
    classification.confidence = 90;
    classification.params = { ...pending.params, ...classification.params };
    classification.sourceText = mergedText;

    if (
        pending.pendingAction === ACTIONS.PRODUCT_SEARCH &&
        HanorkIntentEngine.isVirtuoNumbersContext(pending.sourceText || '')
    ) {
        const q = String(replyText || '').trim();
        classification = {
            action: ACTIONS.RUN_SLASH,
            confidence: 92,
            params: { slash: 'buscar', args: q },
            sourceText: mergedText,
        };
    } else if (pending.pendingAction === ACTIONS.PRODUCT_SEARCH) {
        const unified =
            HanorkIntentEngine.resolveUnifiedSearchIntent(mergedText) ||
            HanorkIntentEngine.resolveVirtuoIntent(mergedText);
        if (unified) {
            classification = { ...unified, sourceText: mergedText, confidence: 90 };
        } else {
            classification.params.query =
                NL.extractProductQuery(replyText, { allowBareReply: true }) ||
                NL.normalizeRawSearchQuery(replyText) ||
                String(replyText).trim();
        }
    } else if (pending.pendingAction === ACTIONS.PLAY_MUSIC) {
        classification.params.query =
            NL.extractMusicQuery(replyText, { allowBareReply: true }) ||
            NL.sanitizePlayQuery(replyText) ||
            null;
        if (
            pending.params?.sendIntent ||
            NL.isSendMusicIntent(mergedText) ||
            NL.isSendMusicIntent(replyText)
        ) {
            classification.params.sendIntent = true;
        }
    } else if (pending.pendingAction === ACTIONS.DOWNLOAD) {
        const urls = mergedText.match(/https?:\/\/[^\s<>"']+/gi);
        if (urls?.[0]) {
            classification.params.url = urls[0].replace(/[.,;)]+$/, '');
            classification.params.urlKind = HanorkIntentEngine.detectUrlKind(classification.params.url);
            classification.params.sendIntent = true;
        } else {
            const ttQ = NL.extractTiktokSearchQuery(replyText, { allowBareReply: true });
            if (ttQ) {
                classification.params.tiktokQuery = ttQ;
                classification.params.sendIntent = true;
            }
            const igP = NL.extractInstagramNLQuery(replyText, { allowBareReply: true });
            if (igP) {
                classification.params.instagramParsed = igP;
                classification.params.sendIntent = true;
            }
        }
    }

    logger.info(`${LOG_PREFIX} clarify_done`, { uid, action: classification.action });

    const actionCheck = HanorkRouterGuard.validateAction(classification.action, {
        inPrivate: !!inPrivate,
        isAdmin: isAdmin(uid),
        params: classification.params,
    });
    if (!actionCheck.allowed) {
        const { Msg, groupGuard: gg, bot: tgBot } = deps;
        const msg =
            actionCheck.reason === 'admin_group' ? COPY.groupAdminPrivate : COPY.groupPrivateAction;
        if (actionCheck.redirectPrivate && gg?.isGroupChat?.(ctx) && tgBot) {
            await gg.replyGroupRedirect(ctx, tgBot, { body: msg, showAlert: true });
        } else {
            await Msg.reply(ctx, msg, null, { parse_mode: 'HTML' });
        }
        return { handled: true };
    }

    await ctx.sendChatAction('typing').catch(() => {});
    const result = await HanorkActionExecutor.execute(ctx, classification, deps);
    if (result?.ok === false && result?.needsClarify) return { handled: false };
    return { handled: result?.ok !== false };
}

module.exports = {
    tryHandle,
    replyConversationalAi,
    hasHanorkMention: HanorkIntentEngine.hasHanorkMention,
    ROUTER_VERSION,
};
