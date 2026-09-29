'use strict';

const { ACTIONS } = require('../../config/hanork-ai-actions');
const NL = require('./HanorkNlExtractors');
const TextNorm = require('./HanorkTextNormalize');

const TTL_SEC = 7200;

const PRONOUN_PRICE_RE =
    /\b(?:coloca|colocar|deixa|deixar|muda|mudar|altera|alterar|troca|trocar|atualiza|ajusta|define)\s+(?:ele|ela|isso|esse|essa|aquele|aquela|o\s+produto)\s+(?:por|pra|para|a|em)\s+/i;
const PRICE_ONLY_RE = /^\d{1,6}(?:[.,]\d{1,2})?\s*\$?$/;
const IMPLICIT_PRICE_RE =
    /\b(?:mais\s+barato|mais\s+caro|deixa\s+por|coloca\s+por|preco\s+(?:dele|dela|disso)|valor\s+(?:dele|dela|disso))\b/i;
const DEICTIC_PRICE_RE =
    /\b(?:muda|altera|troca|atualiza|ajusta)\s+(?:o\s+)?(?:valor|preco)\s*(?:desse|deste|esse|este)?\s*(?:produto|item)?\b/;
const DEICTIC_ITEM_RE =
    /\b(?:muda|altera|troca|atualiza)\s+(?:esse|este|isso)\s+item\b/;
const SHORT_PRICE_RE = /\b(?:deixa|coloca)\s+por\s+\d/;
const BROADCAST_MORE_RE =
    /\b(?:divulga|divulgacao|anuncia|promo|broadcast)\s+(?:mais|melhor|de\s+novo|outra\s+vez)\b/;
const DIVULGAR_MORE_RE = /\b(?:quero\s+)?(?:divulga|divulgar|anunciar)\s+(?:mais|de\s+novo|outra\s+vez)\b/;
const REPEAT_ACTION_RE =
    /\b(?:faz|fazer)\s+igual|(?:de\s+)?novo|outra\s+vez|mesma\s+coisa|igual\s+ao\s+outro\b/;
const DEICTIC_THIS_RE = /\b(?:muda|altera|troca|apaga|exclui|remove|ativa|desativa|pausa)\s+(?:isso|esse|este|aquele)\b/;

const BROADCAST_ACTIONS = new Set([
    ACTIONS.BROADCAST_GROUPS_RUN,
    ACTIONS.BROADCAST_CHANNELS_RUN,
    ACTIONS.BROADCAST_FULL_RUN,
    ACTIONS.BROADCAST_GROUPS_PREPARE,
    ACTIONS.BROADCAST_CHANNELS_PREPARE,
    ACTIONS.BROADCAST_IA_PREPARE,
    ACTIONS.BROADCAST_TEXT_PREPARE,
    ACTIONS.BROADCAST_PRODUCT_PICK,
    ACTIONS.BROADCAST,
]);

const SHOP_ACTIONS = new Set([
    ACTIONS.CART,
    ACTIONS.CHECKOUT,
    ACTIONS.PRODUCT_SEARCH,
    ACTIONS.SHOW_PRODUCTS,
    ACTIONS.RECOMMEND_PRODUCT,
]);

async function get(store, chatId) {
    if (!store?.get) return {};
    const raw = await store.get(chatId);
    return raw && typeof raw === 'object' ? { ...raw } : {};
}

async function save(store, chatId, ctx) {
    if (!store?.set) return;
    const next = { ...ctx, _ts: Date.now() };
    await store.set(chatId, next, TTL_SEC);
}

/**
 * Mescla modos ativos do bot (edição, broadcast, carrinho) no contexto do roteador.
 */
async function mergeActiveModes(chatId, store, deps = {}) {
    const ctx = await get(store, chatId);
    const uid = deps.uid;

    if (deps.editProductMode?.has && uid && (await deps.editProductMode.has(uid))) {
        const em = await deps.editProductMode.get(uid);
        if (em?.pid) {
            ctx.lastProductId = em.pid;
            ctx.lastFocus = 'product';
            const fieldMap = {
                name: 'name',
                price: 'price',
                desc: 'description',
                stock: 'stock',
                cat: 'category',
                photo: 'photo',
                file: 'file_url',
            };
            ctx.pendingField = fieldMap[em.field] || em.field;
        }
    }
    if (deps.broadcastMode?.has && uid && (await deps.broadcastMode.has(uid))) {
        ctx.lastFocus = 'broadcast';
    }
    if (typeof deps.getCart === 'function') {
        try {
            const cart = await deps.getCart(chatId);
            const items = cart?.items || cart?.produtos || [];
            if (Array.isArray(items) && items.length > 0) {
                ctx.lastFocus = ctx.lastFocus || 'cart';
                ctx.cartItemCount = items.length;
            }
        } catch {
            /* ignore */
        }
    }
    return ctx;
}

function normalizedMessage(text) {
    return TextNorm.normalizeForIntent(text);
}

function detectImplicitPriceIntent(text) {
    const raw = String(text || '').trim();
    if (!raw || raw.length < 2) return false;
    const n = normalizedMessage(raw);
    if (PRICE_ONLY_RE.test(raw)) return true;
    if (PRONOUN_PRICE_RE.test(raw)) return true;
    if (IMPLICIT_PRICE_RE.test(n)) return true;
    if (DEICTIC_PRICE_RE.test(n)) return true;
    if (DEICTIC_ITEM_RE.test(n)) return true;
    if (SHORT_PRICE_RE.test(n)) return true;
    return Boolean(NL.extractProductPriceEdit(raw));
}

function enrichProductFieldEdit(text, edit, routerCtx = {}) {
    const raw = String(text || '').trim();
    if (!edit && routerCtx.pendingField && routerCtx.pendingField !== 'price' && routerCtx.lastProductId) {
        if (raw.length >= 2 && !/^(?:sim|nao|não|cancelar?)$/i.test(raw)) {
            return {
                field: routerCtx.pendingField,
                value: raw,
                productId: routerCtx.lastProductId,
                productQuery: routerCtx.lastProductQuery || null,
                needsProduct: false,
                needsValue: false,
            };
        }
    }
    if (!edit) return null;
    if (edit.needsProduct && (routerCtx.lastProductId || routerCtx.lastProductQuery)) {
        return {
            ...edit,
            productId: edit.productId || routerCtx.lastProductId,
            productQuery: edit.productQuery || routerCtx.lastProductQuery,
            needsProduct: false,
        };
    }
    return edit;
}

function enrichProductLifecycle(text, lifecycle, routerCtx = {}) {
    if (!lifecycle) return null;
    const lc = { ...lifecycle };
    if (lc.needsProduct && (routerCtx.lastProductId || routerCtx.lastProductQuery)) {
        lc.productId = lc.productId || routerCtx.lastProductId || null;
        lc.productQuery = lc.productQuery || routerCtx.lastProductQuery || null;
        lc.needsProduct = !lc.productId && !lc.productQuery;
    }
    return lc;
}

function enrichProductPriceEdit(text, edit, routerCtx = {}) {
    const raw = String(text || '').trim();
    const n = normalizedMessage(raw);
    const hasCtxTarget = routerCtx.lastProductId || routerCtx.lastProductQuery;
    const implicit =
        detectImplicitPriceIntent(raw) ||
        (routerCtx.pendingField === 'price' && (PRICE_ONLY_RE.test(raw) || SHORT_PRICE_RE.test(n))) ||
        (routerCtx.lastFocus === 'product' && (DEICTIC_THIS_RE.test(n) || DEICTIC_ITEM_RE.test(n)) && /\b(?:valor|preco|barato|caro)\b/.test(n));

    if (!edit && !implicit) return null;
    if (!edit && implicit && !hasCtxTarget && routerCtx.pendingField !== 'price' && routerCtx.lastFocus !== 'product') {
        return null;
    }

    let productId = edit?.productId || routerCtx.lastProductId || null;
    let productQuery = edit?.productQuery || routerCtx.lastProductQuery || null;
    let price = edit?.price ?? null;

    if (price == null) price = NL.parseMoneyValue(raw);

    if (!edit && implicit) {
        return {
            productId,
            productQuery,
            price,
            needsPrice: price == null,
            needsProduct: !productId && !productQuery,
        };
    }

    if (
        !productId &&
        !productQuery &&
        (edit.needsProduct ||
            PRONOUN_PRICE_RE.test(raw) ||
            IMPLICIT_PRICE_RE.test(n) ||
            DEICTIC_PRICE_RE.test(n) ||
            DEICTIC_ITEM_RE.test(n))
    ) {
        productId = routerCtx.lastProductId || null;
        productQuery = routerCtx.lastProductQuery || null;
    }
    if ((edit.needsPrice || price == null) && NL.parseMoneyValue(raw) != null) {
        price = NL.parseMoneyValue(raw);
    }
    if (!productId && !productQuery && price != null && hasCtxTarget) {
        productId = routerCtx.lastProductId || null;
        productQuery = routerCtx.lastProductQuery || null;
    }

    const needsProduct = !productId && !productQuery;
    const needsPrice = price == null && !needsProduct;

    if (needsProduct && !price) return edit;

    return {
        ...edit,
        productId,
        productQuery,
        price,
        needsPrice,
        needsProduct,
    };
}

function resolveRepeatAction(routerCtx) {
    if (!routerCtx.lastAction || routerCtx.lastAction === ACTIONS.NONE) return null;
    return {
        action: routerCtx.lastAction,
        confidence: 87,
        params: { ...(routerCtx.lastActionParams || {}) },
    };
}

function resolveDivulgarMore(text, routerCtx, isAdmin) {
    const n = normalizedMessage(text);
    if (!DIVULGAR_MORE_RE.test(n) && !BROADCAST_MORE_RE.test(n)) return null;
    if (!isAdmin) return null;

    if (routerCtx.lastFocus === 'whatsapp' || /\b(?:whatsapp|zap|status)\b/.test(n)) {
        return { action: ACTIONS.WHATSAPP, confidence: 88, params: {} };
    }
    if (routerCtx.lastBroadcastAction && BROADCAST_ACTIONS.has(routerCtx.lastBroadcastAction)) {
        return {
            action: routerCtx.lastBroadcastAction,
            confidence: 89,
            params: { ...(routerCtx.lastBroadcastParams || {}) },
        };
    }
    if (/\b(?:grupos?)\b/.test(n)) {
        return { action: ACTIONS.BROADCAST_GROUPS_RUN, confidence: 86, params: { mode: 'catalog' } };
    }
    if (/\b(?:canais?)\b/.test(n)) {
        return { action: ACTIONS.BROADCAST_CHANNELS_RUN, confidence: 86, params: { mode: 'catalog' } };
    }
    if (routerCtx.lastFocus === 'broadcast') {
        return { action: ACTIONS.BROADCAST_FULL_RUN, confidence: 85, params: {} };
    }
    return { action: ACTIONS.BROADCAST, confidence: 82, params: {} };
}

function resolveShopContextBoost(text, classification, routerCtx) {
    const n = normalizedMessage(text);
    const c = { ...classification, params: { ...(classification.params || {}) } };
    let conf = c.confidence || 0;

    if (routerCtx.lastFocus === 'cart' && /\b(?:finalizar|fechar|pagar|checkout)\b/.test(n)) {
        if (c.action === ACTIONS.NONE || c.action === ACTIONS.CHECKOUT || conf < 88) {
            c.action = ACTIONS.CHECKOUT;
            conf = Math.max(conf, 88);
        }
    }
    if (routerCtx.lastFocus === 'cart' && /\b(?:carrinho|itens)\b/.test(n)) {
        c.action = ACTIONS.CART;
        conf = Math.max(conf, 90);
    }
    if (routerCtx.lastOrderId && /\b(?:pedido|rastrear|status)\b/.test(n)) {
        c.params.orderId = routerCtx.lastOrderId;
        if (c.action === ACTIONS.TRACK_ORDER) conf = Math.max(conf, 88);
    }
    if (routerCtx.lastProductQuery && /\b(?:compra|adiciona|coloca)\b/.test(n) && conf < 75) {
        c.params.query = c.params.query || routerCtx.lastProductQuery;
        if (c.action === ACTIONS.PRODUCT_SEARCH) conf = Math.max(conf, 82);
    }

    c.confidence = conf;
    return c;
}

/**
 * Completa classificação com referências do histórico (produto, preço, divulgação, loja).
 */
function enrichClassification(text, classification, routerCtx = {}, options = {}) {
    if (!classification || classification.action === ACTIONS.NONE) {
        const repeat = REPEAT_ACTION_RE.test(normalizedMessage(text)) ? resolveRepeatAction(routerCtx) : null;
        if (repeat) return repeat;
    }

    let c = {
        ...classification,
        params: { ...(classification.params || {}) },
    };

    const isAdmin = !!options.isAdmin;

    const priceEdit = enrichProductPriceEdit(text, NL.extractProductPriceEdit(text), routerCtx);
    const shouldPriceRoute =
        classification.action === ACTIONS.PRODUCT_EDIT_PRICE ||
        (priceEdit &&
            (priceEdit.productId ||
                priceEdit.productQuery ||
                priceEdit.needsProduct ||
                (priceEdit.price != null && routerCtx.pendingField === 'price')));

    const lifecycle = enrichProductLifecycle(text, NL.extractProductLifecycle(text), routerCtx);
    if (lifecycle && (lifecycle.productId || lifecycle.productQuery) && !lifecycle.needsProduct) {
        const action = lifecycle.op === 'pause' ? ACTIONS.PRODUCT_PAUSE : ACTIONS.PRODUCT_REACTIVATE;
        let conf = lifecycle.op === 'pause' ? 86 : 90;
        if (c.action === action) conf = Math.max(c.confidence || 0, conf);
        c.action = action;
        c.confidence = conf;
        c.params = {
            ...c.params,
            productId: lifecycle.productId,
            productQuery: lifecycle.productQuery,
            op: lifecycle.op,
        };
    } else if (
        lifecycle?.needsProduct &&
        routerCtx.lastFocus === 'product' &&
        (DEICTIC_THIS_RE.test(normalizedMessage(text)) || NL.extractProductLifecycle(text))
    ) {
        const action = lifecycle.op === 'pause' ? ACTIONS.PRODUCT_PAUSE : ACTIONS.PRODUCT_REACTIVATE;
        c.action = action;
        c.confidence = 78;
        c.params = {
            productId: routerCtx.lastProductId,
            productQuery: routerCtx.lastProductQuery,
            needsProduct: true,
            op: lifecycle.op,
        };
    }

    const fieldEdit = enrichProductFieldEdit(text, NL.extractProductFieldEdit(text), routerCtx);
    if (
        fieldEdit &&
        fieldEdit.field &&
        (fieldEdit.productId || fieldEdit.productQuery) &&
        fieldEdit.value &&
        !fieldEdit.needsValue
    ) {
        c.action = ACTIONS.PRODUCT_EDIT_FIELD;
        c.confidence = Math.max(c.confidence || 0, 90);
        c.params = {
            field: fieldEdit.field,
            value: fieldEdit.value,
            productId: fieldEdit.productId,
            productQuery: fieldEdit.productQuery,
        };
    } else if (fieldEdit?.needsValue && (fieldEdit.productId || fieldEdit.productQuery)) {
        c.action = ACTIONS.ASK;
        c.confidence = 76;
        c.pendingAction = ACTIONS.PRODUCT_EDIT_FIELD;
        c.params = {
            field: fieldEdit.field,
            productId: fieldEdit.productId,
            productQuery: fieldEdit.productQuery,
        };
    }

    if (shouldPriceRoute && priceEdit) {
        const hasTarget = priceEdit.productId || priceEdit.productQuery;
        const hasPrice = priceEdit.price != null;
        let conf = c.confidence || 0;

        if (c.action !== ACTIONS.PRODUCT_EDIT_PRICE) {
            c.action = ACTIONS.PRODUCT_EDIT_PRICE;
            conf = hasTarget && hasPrice ? 92 : hasTarget ? 84 : 76;
        } else if (hasTarget && hasPrice) {
            conf = Math.max(conf, 94);
        } else if (hasTarget) {
            conf = Math.max(conf, 82);
        }

        c.confidence = conf;
        c.params = {
            ...c.params,
            productId: priceEdit.productId,
            productQuery: priceEdit.productQuery,
            price: priceEdit.price,
            needsPrice: priceEdit.needsPrice,
            needsProduct: priceEdit.needsProduct,
        };
    }

    const n = normalizedMessage(text);

    const divulgar = resolveDivulgarMore(text, routerCtx, isAdmin);
    if (divulgar && (c.confidence < 88 || c.action === ACTIONS.NONE || c.action === ACTIONS.ASK)) {
        c = { ...c, ...divulgar };
    } else if (
        BROADCAST_MORE_RE.test(n) &&
        routerCtx.lastBroadcastAction &&
        BROADCAST_ACTIONS.has(routerCtx.lastBroadcastAction)
    ) {
        if (c.confidence < 90 || c.action === ACTIONS.NONE || c.action === ACTIONS.ASK) {
            c.action = routerCtx.lastBroadcastAction;
            c.confidence = Math.max(c.confidence || 0, 88);
            c.params = { ...(routerCtx.lastBroadcastParams || {}), ...c.params };
        }
    }

    if (REPEAT_ACTION_RE.test(n) && routerCtx.lastAction) {
        c.action = routerCtx.lastAction;
        c.confidence = Math.max(c.confidence || 0, 86);
        c.params = { ...(routerCtx.lastActionParams || {}), ...c.params };
    }

    if (/\b(?:whatsapp|zap|status)\b/.test(n)) {
        if (routerCtx.lastFocus === 'whatsapp') c.params.channelHint = 'whatsapp';
    }
    if (/\b(?:grupos?|canais?|telegram|ponte)\b/.test(n) && routerCtx.lastFocus === 'broadcast') {
        c.params.contextHint = routerCtx.lastFocus;
    }

    c = resolveShopContextBoost(text, c, routerCtx);

    return c;
}

function formatForPlanner(routerCtx = {}) {
    if (!routerCtx || !Object.keys(routerCtx).length) return '';
    const slim = {
        lastProductId: routerCtx.lastProductId || null,
        lastProductQuery: routerCtx.lastProductQuery || null,
        pendingField: routerCtx.pendingField || null,
        lastFocus: routerCtx.lastFocus || null,
        lastAction: routerCtx.lastAction || null,
        lastBroadcastAction: routerCtx.lastBroadcastAction || null,
        lastOrderId: routerCtx.lastOrderId || null,
        cartItemCount: routerCtx.cartItemCount || null,
    };
    Object.keys(slim).forEach((k) => {
        if (slim[k] == null) delete slim[k];
    });
    if (!Object.keys(slim).length) return '';
    return `[CONTEXTO_RECENTE] ${JSON.stringify(slim)}\n`;
}

async function recordIntent(chatId, store, text, classification) {
    if (!store?.set || !classification) return;
    const ctx = await get(store, chatId);

    if (classification.params?.productQuery) ctx.lastProductQuery = classification.params.productQuery;
    if (classification.params?.productId) ctx.lastProductId = classification.params.productId;
    if (classification.params?.orderId) ctx.lastOrderId = classification.params.orderId;

    if (classification.action === ACTIONS.PRODUCT_EDIT_PRICE) {
        ctx.lastFocus = 'product';
        ctx.pendingField = classification.params?.price == null ? 'price' : null;
    }
    if (classification.action === ACTIONS.PRODUCT_EDIT_FIELD && classification.params?.field) {
        ctx.lastFocus = 'product';
        ctx.pendingField = classification.params.needsValue ? classification.params.field : null;
    }
    if (classification.action === ACTIONS.PRODUCT_PAUSE || classification.action === ACTIONS.PRODUCT_REACTIVATE) {
        ctx.lastFocus = 'product';
        ctx.pendingField = null;
    }

    if (SHOP_ACTIONS.has(classification.action)) {
        if (classification.action === ACTIONS.CART) ctx.lastFocus = 'cart';
        if (classification.action === ACTIONS.CHECKOUT) ctx.lastFocus = 'checkout';
        if (classification.action === ACTIONS.PRODUCT_SEARCH) ctx.lastFocus = 'shop';
    }

    if (BROADCAST_ACTIONS.has(classification.action)) {
        ctx.lastFocus = 'broadcast';
        ctx.lastBroadcastAction = classification.action;
        ctx.lastBroadcastParams = { ...(classification.params || {}) };
    }

    if (classification.action === ACTIONS.WHATSAPP) ctx.lastFocus = 'whatsapp';

    if (classification.action && classification.action !== ACTIONS.NONE && classification.action !== ACTIONS.ASK) {
        ctx.lastAction = classification.action;
        ctx.lastActionParams = { ...(classification.params || {}) };
    }

    if (/\b(?:whatsapp|zap)\b/i.test(String(text || ''))) ctx.lastFocus = 'whatsapp';

    ctx.lastMessageSnippet = String(text || '').slice(0, 160);
    await save(store, chatId, ctx);
}

async function recordResult(chatId, store, intent, result = {}) {
    if (!store?.set) return;
    const ctx = await get(store, chatId);
    if (result.productId) ctx.lastProductId = result.productId;
    if (intent?.params?.productQuery) ctx.lastProductQuery = intent.params.productQuery;
    if (intent?.action === ACTIONS.PRODUCT_EDIT_PRICE && result.ok) {
        ctx.pendingField = null;
        ctx.lastFocus = 'product';
    }
    if (intent?.action === ACTIONS.PRODUCT_PAUSE && result.ok) {
        ctx.lastProductActive = false;
    }
    if (intent?.action === ACTIONS.PRODUCT_REACTIVATE && result.ok) {
        ctx.lastProductActive = true;
    }
    await save(store, chatId, ctx);
}

module.exports = {
    get,
    save,
    mergeActiveModes,
    enrichClassification,
    enrichProductFieldEdit,
    enrichProductLifecycle,
    enrichProductPriceEdit,
    detectImplicitPriceIntent,
    formatForPlanner,
    recordIntent,
    recordResult,
    normalizedMessage,
};
