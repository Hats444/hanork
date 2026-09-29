'use strict';

const ZeroTwoAi = require('../ZeroTwoAiService');
const {
    ACTIONS,
    CONFIDENCE_EXECUTE,
} = require('../../config/hanork-ai-actions');
const ActionRegistry = require('../../core/hanorkGateway/ActionRegistry');
const hanorkAiCore = require('../../core/hanorkAiCore');
const HanorkIntentEngine = require('./HanorkIntentEngine');
const HanorkRouterContext = require('./HanorkRouterContext');
const NL = require('./HanorkNlExtractors');
const logger = require('../../config/logger');

const LOG_PREFIX = '[HanorkLlmPlanner]';
const ROUTABLE_SET = new Set(ActionRegistry.getRoutableActionIds());

const ADMIN_ACTIONS = new Set([
    ACTIONS.ADMIN,
    ACTIONS.ADMIN_STATS,
    ACTIONS.ADMIN_ORDERS,
    ACTIONS.ADMIN_PRODUCTS,
    ACTIONS.ADMIN_GROUPS,
    ACTIONS.ADMIN_CHANNELS,
    ACTIONS.ADMIN_TICKETS,
    ACTIONS.ADMIN_FINANCE,
    ACTIONS.ADMIN_REPORT,
    ACTIONS.ADMIN_USERS,
    ACTIONS.WHATSAPP,
    ACTIONS.BROADCAST,
    ACTIONS.BROADCAST_GROUPS_PREPARE,
    ACTIONS.BROADCAST_GROUPS_RUN,
    ACTIONS.BROADCAST_CHANNELS_RUN,
    ACTIONS.BROADCAST_FULL_RUN,
    ACTIONS.BROADCAST_IA_PREPARE,
    ACTIONS.BROADCAST_TEXT_PREPARE,
    ACTIONS.BROADCAST_PRODUCT_PICK,
    ACTIONS.PRODUCT_EDIT_PRICE,
    ACTIONS.PRODUCT_EDIT_FIELD,
    ACTIONS.PRODUCT_PAUSE,
    ACTIONS.PRODUCT_REACTIVATE,
    ACTIONS.RUN_CALLBACK,
]);

const RATE_MAX = Number(process.env.HANORK_LLM_RATE_MAX) || 5;
const RATE_WINDOW_MS = Number(process.env.HANORK_LLM_RATE_MS) || 60000;

const _rate = new Map();

function checkRate(uid) {
    if (!uid) return { allowed: true };
    const now = Date.now();
    let bucket = _rate.get(uid);
    if (!bucket || now >= bucket.resetAt) {
        bucket = { count: 0, resetAt: now + RATE_WINDOW_MS };
        _rate.set(uid, bucket);
    }
    if (bucket.count >= RATE_MAX) {
        return { allowed: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
    }
    bucket.count += 1;
    return { allowed: true };
}

function isSmallTalk(text) {
    const norm = HanorkIntentEngine.normalize(text);
    return /^(?:oi|ol[aá]|hey|bom\s+dia|boa\s+tarde|boa\s+noite|tudo\s+bem|kk+|haha|ok+|sim|n[aã]o|blz)$/i.test(norm);
}

/**
 * LLM só quando regras não ativaram ou admin/PV com intenção ambígua.
 */
function shouldTryLlm(rawText, classifyCtx, ruleClassification, gate, { fromCommand = false, inPrivate = false, inGroup = false } = {}) {
    if (!ZeroTwoAi.isConfigured()) return false;

    const text = String(rawText || '').trim();
    if (!text) return false;

    const hasMention = HanorkIntentEngine.hasHanorkMention(text);
    const hasImplicit = HanorkIntentEngine.hasImplicitBotAddress(text);
    const addressed = fromCommand || hasMention || (inPrivate && hasImplicit);

    if (!addressed && (text.length < 4 || isSmallTalk(text))) return false;

    if (fromCommand || hasMention) return true;

    if (classifyCtx.isAdmin && classifyCtx.inPrivate) {
        if (gate?.reason === 'low_confidence' || gate?.reason === 'none') return true;
        if (ruleClassification?.action === ACTIONS.NONE) return true;
        if ((ruleClassification?.confidence || 0) < CONFIDENCE_EXECUTE - 5) return true;
    }

    if (inPrivate && hasImplicit && gate?.reason === 'low_confidence') return true;
    if (inGroup && hasMention && gate?.reason === 'low_confidence') return true;

    return false;
}

function buildPlannerPrompt(text, ctx) {
    if (hanorkAiCore.isAiCoreEnabled()) {
        const ctxBlock = HanorkRouterContext.formatForPlanner(ctx.routerContext || {});
        return hanorkAiCore.buildPlannerPrompt(text, {
            ...ctx,
            contextBlock: ctxBlock ? `${ctxBlock}\n` : '',
        });
    }
    const actions = ActionRegistry.formatForPlanner();
    const ctxBlock = HanorkRouterContext.formatForPlanner(ctx.routerContext || {});
    return (
        `[PAPEL] Planejador do Hanork (bot de loja Telegram). Responda APENAS um JSON válido, sem markdown.\n` +
        `[USUÁRIO] admin=${!!ctx.isAdmin}, privado=${!!ctx.inPrivate}\n` +
        ctxBlock +
        `[MENSAGEM] ${text}\n` +
        `[AÇÕES — use somente ids desta lista]\n- ${actions}\n` +
        `[REGRAS]\n` +
        `- Divulgação em grupos sem texto custom → broadcast_groups_run params {"mode":"catalog"}\n` +
        `- Texto custom só com mensagem explícita → params {"mode":"custom","body":"..."}\n` +
        `- Recomendação de produto → recommend_product\n` +
        `- Busca SMM + Números SMS → run_slash params {"slash":"buscar","args":"seguidores instagram"} ou {"slash":"buscar","args":"whatsapp brasil"}\n` +
        `- Busca por nome de produto da loja → product_search com params.query (NÃO use para números SMS virtuais)\n` +
        `- Números SMS / WhatsApp / Telegram para verificação → run_slash params {"slash":"numeros","args":"whatsapp brasil"} ou run_callback virtuo:home\n` +
        `- Dúvida "como procuro números" → run_callback virtuo:home com label explicando /numeros\n` +
        `- Alterar preço de produto (admin) → product_edit_price com params {"productQuery":"nome","price":29.9} ou productId; use CONTEXTO_RECENTE para "ele/isso/aquele"\n` +
        `- Pausar produto no catálogo → product_pause; reativar → product_reactivate (sempre productId ou productQuery)\n` +
        `- Música → play_music com params.query; link YouTube → params.query URL\n` +
        `- Download TikTok/Instagram → download com params.url\n` +
        `- Incerto → action "none"\n` +
        `- Nunca use action fora da lista\n` +
        `[FORMATO] {"action":"nome","params":{},"confidence":0-100}`
    );
}

function extractJsonObject(raw) {
    const s = String(raw || '').trim();
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    try {
        return JSON.parse(s.slice(start, end + 1));
    } catch {
        return null;
    }
}

function sanitizeParams(action, params, sourceText, ctx) {
    const p = params && typeof params === 'object' ? { ...params } : {};

    if (action === ACTIONS.PRODUCT_SEARCH && p.query) {
        p.query = NL.sanitizeProductSearchQuery(p.query) || String(p.query).trim().slice(0, 80);
    }
    if (action === ACTIONS.PRODUCT_EDIT_PRICE) {
        const edit = HanorkRouterContext.enrichProductPriceEdit(
            sourceText,
            NL.extractProductPriceEdit(sourceText),
            ctx.routerContext || {}
        );
        if (edit) {
            if (edit.productId) p.productId = edit.productId;
            if (edit.productQuery) p.productQuery = edit.productQuery;
            if (edit.price != null) p.price = edit.price;
        }
        if (!p.productId && !p.productQuery) return null;
    }
    if (action === ACTIONS.PRODUCT_PAUSE || action === ACTIONS.PRODUCT_REACTIVATE) {
        const lc = HanorkRouterContext.enrichProductLifecycle(
            sourceText,
            NL.extractProductLifecycle(sourceText),
            ctx.routerContext || {}
        );
        if (lc) {
            if (lc.productId) p.productId = lc.productId;
            if (lc.productQuery) p.productQuery = lc.productQuery;
        }
        if (!p.productId && !p.productQuery) return null;
    }
    if (action === ACTIONS.PLAY_MUSIC && p.query) {
        p.query = NL.sanitizePlayQuery(p.query) || String(p.query).trim().slice(0, 120);
        if (!p.sendIntent && NL.isSendMusicIntent(sourceText)) p.sendIntent = true;
    }
    if (action === ACTIONS.DOWNLOAD && p.url) {
        const urls = String(p.url).match(/https?:\/\/[^\s<>"']+/gi);
        if (urls?.[0]) {
            p.url = urls[0].replace(/[.,;)]+$/, '');
            p.urlKind = HanorkIntentEngine.detectUrlKind(p.url);
        } else {
            delete p.url;
        }
    }

    if (
        action === ACTIONS.BROADCAST_GROUPS_RUN ||
        action === ACTIONS.BROADCAST_CHANNELS_RUN ||
        action === ACTIONS.BROADCAST_FULL_RUN
    ) {
        const explicit = NL.extractBroadcastBody(sourceText);
        if (explicit) {
            p.mode = 'custom';
            p.body = explicit;
        } else if (!p.mode) {
            p.mode = 'catalog';
        }
        if (p.mode === 'custom' && !p.body) {
            p.mode = 'catalog';
            delete p.body;
        }
    }

    if (action === ACTIONS.RUN_SLASH && p.slash) {
        p.slash = String(p.slash).replace(/^\//, '').trim();
        p.args = p.args ? String(p.args).trim() : '';
    }

    if (ADMIN_ACTIONS.has(action) && !ctx.isAdmin) {
        return null;
    }

    return p;
}

function validatePlannerOutput(parsed, sourceText, ctx) {
    if (!parsed || typeof parsed !== 'object') return null;

    let action = String(parsed.action || ACTIONS.NONE).trim().toLowerCase();
    let params = parsed.params && typeof parsed.params === 'object' ? { ...parsed.params } : {};
    if (parsed.tool && hanorkAiCore.isAiCoreEnabled()) {
        const resolved = hanorkAiCore.resolveTool(parsed.tool, params, {
            isAdmin: !!ctx.isAdmin,
        });
        if (resolved) {
            action = resolved.action;
            params = { ...resolved.params, ...params };
        } else if (action === ACTIONS.NONE || !action) {
            return null;
        }
    }
    if (action === 'ask') action = ACTIONS.NONE;
    if (!ActionRegistry.isRegisteredAction(action) && action !== ACTIONS.NONE) return null;

    if (action === ACTIONS.NONE) {
        return { action: ACTIONS.NONE, confidence: 100, params: {}, _llm: true };
    }

    if (HanorkIntentEngine.isObviousNonBotMessage(sourceText, ctx)) {
        return { action: ACTIONS.NONE, confidence: 100, params: {}, _llm: true };
    }

    const sanitized = sanitizeParams(action, params, sourceText, ctx);
    if (sanitized === null) return null;

    let confidence = Number(parsed.confidence);
    if (!Number.isFinite(confidence)) confidence = 82;
    confidence = Math.min(100, Math.max(50, Math.round(confidence)));

    if (action === ACTIONS.PRODUCT_SEARCH && !sanitized.query) return null;

    if (action === ACTIONS.PRODUCT_SEARCH && HanorkIntentEngine.isVirtuoNumbersContext(sourceText)) {
        const virtuo = HanorkIntentEngine.resolveVirtuoIntent(sourceText);
        if (virtuo) {
            return { ...virtuo, _llm: true, sourceText };
        }
        const unified = HanorkIntentEngine.resolveUnifiedSearchIntent(sourceText);
        if (unified) {
            return { ...unified, _llm: true, sourceText };
        }
    }

    if (action === ACTIONS.PLAY_MUSIC && !sanitized.query) return null;
    if (action === ACTIONS.DOWNLOAD && !sanitized.url) {
        const urls = (String(sourceText).match(/https?:\/\/[^\s<>"']+/gi) || []).map((u) =>
            u.replace(/[.,;)]+$/, '')
        );
        if (urls[0]) {
            sanitized.url = urls[0];
            sanitized.urlKind = HanorkIntentEngine.detectUrlKind(urls[0]);
        } else {
            return null;
        }
    }

    let out = { action, confidence, params: sanitized, _llm: true, sourceText };
    if (ctx.routerContext && Object.keys(ctx.routerContext).length) {
        out = HanorkRouterContext.enrichClassification(sourceText, out, ctx.routerContext, {
            isAdmin: ctx.isAdmin,
        });
        out._llm = true;
        out.sourceText = sourceText;
    }
    return out;
}

/**
 * @returns {Promise<{ action, confidence, params, _llm } | null>}
 */
async function plan(rawText, classifyCtx, ruleClassification, options = {}) {
    const { uid, fromCommand = false, inPrivate = false, inGroup = false, gate = null } = options;
    const text = String(rawText || '').trim();

    if (!shouldTryLlm(text, classifyCtx, ruleClassification, gate, { fromCommand, inPrivate, inGroup })) {
        return null;
    }

    const rate = checkRate(uid);
    if (!rate.allowed) {
        logger.info(`${LOG_PREFIX} rate_limited`, { uid, retryAfter: rate.retryAfter });
        return null;
    }

    try {
        const query = buildPlannerPrompt(text, classifyCtx);
        const raw = await ZeroTwoAi.callGptApi(query);
        const parsed = extractJsonObject(raw);
        const validated = validatePlannerOutput(parsed, text, classifyCtx);

        if (!validated || validated.action === ACTIONS.NONE) {
            logger.info(`${LOG_PREFIX} none`, { uid, raw: String(raw).slice(0, 120) });
            return validated?.action === ACTIONS.NONE ? validated : null;
        }

        logger.info(`${LOG_PREFIX} planned`, {
            uid,
            action: validated.action,
            confidence: validated.confidence,
            ruleAction: ruleClassification?.action,
        });

        return validated;
    } catch (err) {
        logger.warn(`${LOG_PREFIX} error`, { uid, message: err.message });
        return null;
    }
}

function resolveGateAfterPlan(sourceText, classification, { fromCommand = false, inPrivate = false, inGroup = false } = {}) {
    const gate = HanorkIntentEngine.shouldActivate(sourceText, classification, {
        fromCommand,
        inPrivate,
        inGroup,
    });
    if (gate.activate) return gate;

    if (classification._llm) {
        if (fromCommand) return { activate: true, reason: 'llm_command' };
        if (classification.confidence >= CONFIDENCE_EXECUTE - 10) {
            return { activate: true, reason: 'llm_confident' };
        }
        if (
            HanorkIntentEngine.hasHanorkMention(sourceText) &&
            classification.confidence >= 65 &&
            HanorkIntentEngine.isOperationalAction(classification.action)
        ) {
            return { activate: true, reason: 'llm_hanork' };
        }
    }

    return gate;
}

module.exports = {
    plan,
    shouldTryLlm,
    resolveGateAfterPlan,
    validatePlannerOutput,
    checkRate,
};
