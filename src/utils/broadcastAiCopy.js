'use strict';

const logger = require('../config/logger');
const ZeroTwoAi = require('../services/ZeroTwoAiService');
const { sanitizeAiBodyText, recoverPromoBody } = require('./aiContentSanitizer');
const GptQueue = require('../services/GptRequestQueue');

function shouldDeferAiToTemplate() {
    return (
        ZeroTwoAi.isRateLimited?.() ||
        GptQueue.isBootPhase() ||
        GptQueue.isBootGuardActive()
    );
}
const {
    buildTelegramHtmlPromo,
    buildWaPlainPromo,
    stripHtml,
    trimDesc,
    sanitizeTelegramHtml,
} = require('./persuasiveProductCopy');
const {
    polishAiBody,
    polishPromoHtml,
    polishPromoPlain,
    htmlToPlainPromo,
    isTelegramHtmlBalanced,
} = require('./broadcastTextClean');

const KV_VARIATION = 'broadcast:ai_variation';

const PROMO_ANGLES = [
    {
        id: 'urgencia',
        hint: 'Destaque urgência e oportunidade limitada, sem mentir estoque.',
    },
    {
        id: 'beneficio',
        hint: 'Destaque benefício principal e entrega automática após o PIX.',
    },
    {
        id: 'facilidade',
        hint: 'Destaque simplicidade: comprar em poucos toques no Telegram.',
    },
    {
        id: 'confianca',
        hint: 'Destaque segurança do Mercado Pago e garantia de 7 dias.',
    },
    {
        id: 'exclusivo',
        hint: 'Destaque que é oferta da loja Hanork, tom exclusivo mas honesto.',
    },
    {
        id: 'resultado',
        hint: 'Destaque o resultado que o cliente obtém com o produto.',
    },
    {
        id: 'curiosidade',
        hint: 'Abra com curiosidade — faça o leitor querer saber mais sem clickbait.',
    },
    {
        id: 'economia',
        hint: 'Destaque custo-benefício e economia real em relação a alternativas.',
    },
    {
        id: 'transformacao',
        hint: 'Mostre a transformação antes/depois que o cliente ganha com o produto.',
    },
    {
        id: 'escassez',
        hint: 'Tom de escassez honesta — oportunidade que pode não voltar, sem mentir estoque.',
    },
];

function envFlag(name) {
    const v = String(process.env[name] || '').toLowerCase();
    return v === '1' || v === 'true' || v === 'yes';
}

function isAiBroadcastEnabled() {
    const enabled =
        envFlag('AUTO_BROADCAST_USE_AI') ||
        envFlag('BROADCAST_USE_AI') ||
        envFlag('HANORK_WA_CATALOG_USE_AI') ||
        envFlag('HANORK_WA_PROMO_USE_AI');
    return enabled && ZeroTwoAi.isConfigured();
}

function isAiAvailableNow() {
    return isAiBroadcastEnabled() && !shouldDeferAi();
}

let _generatingDepth = 0;

function shouldDeferAi() {
    let noProviders = false;
    let gatewayOutage = false;
    try {
        const GptProviderPool = require('../services/GptProviderPool');
        gatewayOutage =
            typeof GptProviderPool.isGatewayOutage === 'function' &&
            GptProviderPool.isGatewayOutage();
        noProviders =
            typeof GptProviderPool.hasAvailableProvider === 'function' &&
            !GptProviderPool.hasAvailableProvider();
    } catch {
        /* ignore */
    }
    const queueBusy = (() => {
        try {
            const s = GptQueue.getStats();
            return (s?.active || 0) > 0 || (s?.queue || 0) > 1;
        } catch {
            return false;
        }
    })();
    return (
        ZeroTwoAi.isBootGuardActive?.() ||
        ZeroTwoAi.isBootPhase?.() ||
        ZeroTwoAi.isRateLimited?.() ||
        gatewayOutage ||
        noProviders ||
        queueBusy ||
        _generatingDepth > 1
    );
}

function templatePromo(product, { sale, botLink }) {
    const { withPromoTemplate } = require('../data/productPromoTemplates');
    const tpl = buildTelegramHtmlPromo(withPromoTemplate(product), { sale, botLink });
    return polishPromoHtml(sanitizeTelegramHtml(tpl), { productName: product.name });
}

function bumpVariationIndex(dbRaw) {
    try {
        const db = dbRaw();
        const row = db.prepare('SELECT value FROM kv_store WHERE key=?').get(KV_VARIATION);
        const n = (row ? parseInt(row.value, 10) : 0) + 1;
        db.prepare(
            `INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, datetime('now'))`
        ).run(KV_VARIATION, String(n));
        return Number.isFinite(n) ? n : Date.now();
    } catch {
        return Date.now();
    }
}

function pickAngle(variationIndex, productId = 0) {
    const i = Math.abs(variationIndex + Number(productId) * 3) % PROMO_ANGLES.length;
    return PROMO_ANGLES[i];
}

function formatBrl(n) {
    return `R$ ${Number(n).toFixed(2)}`;
}

function buildPriceLines(p, sale) {
    const price = Number(p.price);
    if (sale) {
        const salePrice = Number(sale.sale_price);
        const pct = Math.round(((price - salePrice) / price) * 100);
        return {
            line: `Preço promocional: de ${formatBrl(price)} por ${formatBrl(salePrice)} (-${pct}%).`,
            precoLabel: formatBrl(salePrice),
            hasSale: true,
        };
    }
    return {
        line: `Preço: ${formatBrl(price)}.`,
        precoLabel: formatBrl(price),
        hasSale: false,
    };
}

function buildProductAiQuery(p, { sale, angle, botName }) {
    const { getProductPromoBody } = require('../data/productPromoTemplates');
    const price = buildPriceLines(p, sale);
    const desc = trimDesc(getProductPromoBody(p) || p.description || '', 600);
    return (
        `[PAPEL] Copywriter de vendas do ${botName || 'Hanork'} para Telegram e WhatsApp. ` +
        `Escreva APENAS o corpo da divulgação (benefícios + urgência leve). ` +
        `Tom persuasivo para atrair compradores: destaque o problema que resolve, benefício principal e por que vale a pena agora — sem exagero nem promessas falsas. ` +
        `NUNCA repita o nome do produto "${p.name}" no texto — o sistema já coloca o título. ` +
        `NUNCA repita a mesma frase, parágrafo ou linha duas vezes. ` +
        `Português BR impecável: acentos corretos (você, não, já, após, automática, disponível), concordância de gênero ("divulgação liberada", não "liberado"). ` +
        `HTML permitido APENAS: <b>, <i>, <u>, <s>. PROIBIDO: div, p, span, br, h1, listas, links <a>, URLs, t.me, botões, CTAs ("clique aqui", "compre agora"). Use quebras de linha normais. Sem emojis. Sem asterisco. 3 a 5 frases curtas, persuasivas, honestas. ` +
        `[ESTILO DESTA RODADA] ${angle.hint} ` +
        `[REGRAS] Não invente recursos que não existam. Não cite preço (o sistema adiciona). Não cite APIs ou tecnologia interna. ` +
        `Foque em levar o leitor a tocar no botão de compra. Texto diferente de anúncios anteriores. ` +
        `[PRODUTO] Nome: ${p.name}. ${price.line} ` +
        (p.category ? `Categoria: ${p.category}. ` : '') +
        (desc ? `Descrição: ${desc}. ` : '') +
        `Pagamento PIX (Mercado Pago), entrega automática no Telegram após confirmação. ` +
        `NUNCA use persona Zero Two, Darling ou se apresente. NUNCA diga "desculpe". ` +
        `[SAÍDA] Somente o texto HTML do corpo, sem preço em linha separada no final (o sistema adiciona preço e botão).`
    );
}

function buildThemeAiQuery(theme, { angle, botName, stats }) {
    const extra = stats
        ? `Loja com ${stats.products} produto(s) ativos e ${stats.users} clientes cadastrados. `
        : '';
    return (
        `[PAPEL] Copywriter do ${botName || 'Hanork'} para divulgação em grupos Telegram. ` +
        `HTML APENAS <b>, <i>, <u>, <s>. PROIBIDO div/p/span/br, links, URLs, botões e CTAs. Quebras de linha normais. Sem emojis. Sem asterisco. 4 a 6 linhas. Persuasivo e variado. ` +
        `[ESTILO] ${angle.hint} ` +
        `${extra}` +
        `[TEMA] ${String(theme || '').trim()} ` +
        `NÃO inclua links nem chamadas de ação — o sistema adiciona botões depois. Texto único, não repita frases de anúncios genéricos.`
    );
}

function mergeProductBody(p, { sale, botLink, aiBody }) {
    const price = buildPriceLines(p, sale);
    const raw = String(aiBody || '').trim();
    let body = sanitizeAiBodyText(polishAiBody(raw, p.name), { productName: p.name });
    if (!body && raw) {
        body = recoverPromoBody(raw, p.name);
    }
    body = sanitizeTelegramHtml(body);
    if (!body) return null;
    let texto = `<b>${escapeHtmlName(p.name)}</b>\n\n${body}\n\n`;
    if (price.hasSale) {
        texto += `<s>${formatBrl(Number(p.price))}</s> → <b>${price.precoLabel}</b> <i>oferta ativa</i>\n\n`;
    } else {
        texto += `<b>${price.precoLabel}</b>\n\n`;
    }
    if (botLink) {
        texto += `<a href="${botLink}">Comprar agora — ${price.precoLabel}</a>\n`;
        texto += '<i>Entrega automática após confirmação do PIX.</i>';
    } else {
        texto += '<i>Abra o bot e finalize em segundos. Entrega automática após o pagamento.</i>';
    }
    return polishPromoHtml(sanitizeTelegramHtml(texto), { productName: p.name });
}

function escapeHtmlName(s) {
    return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * Texto de divulgação de produto (automática ou manual).
 */
function deferAiReason(channel) {
    if (channel === 'tg' && !GptQueue.canUseAiForTelegram()) return 'wa priority / fila ocupada';
    try {
        const GptProviderPool = require('../services/GptProviderPool');
        if (
            typeof GptProviderPool.isGatewayOutage === 'function' &&
            GptProviderPool.isGatewayOutage()
        ) {
            return 'gateway outage';
        }
        if (
            typeof GptProviderPool.hasAvailableProvider === 'function' &&
            !GptProviderPool.hasAvailableProvider()
        ) {
            return 'providers indisponíveis';
        }
    } catch {
        /* ignore */
    }
    if (ZeroTwoAi.isRateLimited?.()) return 'rate limit';
    if (ZeroTwoAi.isBootGuardActive?.()) return 'boot guard';
    if (ZeroTwoAi.isBootPhase?.()) return 'boot phase';
    if (_generatingDepth > 1) return 'recursion guard';
    return 'guard';
}

function shouldDeferAiForChannel(channel = 'wa') {
    if (shouldDeferAi()) return true;
    if (channel === 'tg' && !GptQueue.canUseAiForTelegram()) return true;
    return false;
}

async function generateProductPromoHtml(product, options = {}) {
    const {
        sale = null,
        botLink = null,
        dbRaw = null,
        forceTemplate = false,
        stableCopy = false,
        channel = 'wa',
    } = options;

    const ch = channel === 'tg' ? 'tg' : 'wa';

    if (forceTemplate || !isAiBroadcastEnabled() || shouldDeferAiForChannel(ch)) {
        if (isAiBroadcastEnabled() && !forceTemplate && shouldDeferAiForChannel(ch)) {
            logger.info('[AI_COPY] defer IA — template', {
                productId: product.id,
                channel: ch,
                reason: deferAiReason(ch),
            });
        }
        return templatePromo(product, { sale, botLink });
    }

    const variationIndex = stableCopy
        ? Number(product.id) || 0
        : dbRaw
          ? bumpVariationIndex(dbRaw)
          : Date.now();
    const angle = pickAngle(variationIndex, product.id);
    const cacheKey = stableCopy
        ? `promo:stable:v2:${product.id}`
        : `promo:${product.id}:${angle.id}`;

    _generatingDepth++;
    try {
        const raw = await ZeroTwoAi.callGptApi(
            buildProductAiQuery(product, {
                sale,
                angle,
                botName: process.env.BOT_DISPLAY_NAME || 'Hanork',
            }),
            { productId: product.id, cacheKey, channel: ch }
        );
        const merged = mergeProductBody(product, {
            sale,
            botLink,
            aiBody: String(raw || '').trim(),
        });
        if (merged && merged.length > 40 && isTelegramHtmlBalanced(merged)) {
            logger.info('[AI_COPY] copy generated', {
                productId: product.id,
                angle: angle.id,
                variationIndex,
                stableCopy,
                channel: ch,
            });
            return merged;
        }
        const reason = !merged
            ? 'empty_ai_body'
            : merged.length <= 40
              ? 'html_too_short'
              : 'html_unbalanced';
        GptQueue.invalidateProductCache(product.id);
        logger.info('[AI_COPY] fallback template (IA vazia/inválida)', {
            productId: product.id,
            channel: ch,
            reason,
            rawPreview: String(raw || '').slice(0, 80),
        });
    } catch (e) {
        logger.info('[AI_COPY] fallback template (IA indisponível)', {
            productId: product.id,
            channel: ch,
            reason: e?.message || 'api_error',
        });
    } finally {
        _generatingDepth = Math.max(0, _generatingDepth - 1);
    }

    return templatePromo(product, { sale, botLink });
}

/**
 * Texto plano para WhatsApp — montagem direta (sem HTML→plain que duplicava preço/CTA).
 */
async function generateProductPromoPlain(product, options = {}) {
    const {
        sale = null,
        username = '',
        dbRaw = null,
        forceTemplate = false,
        stableCopy = false,
        channel = 'wa',
    } = options;
    const ch = channel === 'tg' ? 'tg' : 'wa';
    const { prepareWaPromoPlain } = require('./waCaptionPrepare');
    const { buildWaPlainFromParts, buildWaPlainPromo } = require('./persuasiveProductCopy');
    const { getProductPromoBody } = require('../data/productPromoTemplates');
    const { trimDesc } = require('./persuasiveProductCopy');

    if (forceTemplate || !isAiBroadcastEnabled() || shouldDeferAiForChannel(ch)) {
        if (isAiBroadcastEnabled() && !forceTemplate && shouldDeferAiForChannel(ch)) {
            logger.debug('[AI_COPY] defer IA — template', {
                productId: product.id,
                channel: ch,
                reason: deferAiReason(ch),
            });
        }
        return buildWaPlainPromo(product, { sale, username });
    }

    const botLink = username ? `https://t.me/${username}?start=buy_${product.id}` : null;
    const price = buildPriceLines(product, sale);
    const variationIndex = stableCopy
        ? Number(product.id) || 0
        : dbRaw
          ? bumpVariationIndex(dbRaw)
          : Date.now();
    const angle = pickAngle(variationIndex, product.id);
    const cacheKey = stableCopy
        ? `promo:stable:v2:${product.id}`
        : `promo:${product.id}:${angle.id}`;

    _generatingDepth++;
    try {
        const raw = await ZeroTwoAi.callGptApi(
            buildProductAiQuery(product, {
                sale,
                angle,
                botName: process.env.BOT_DISPLAY_NAME || 'Hanork',
            }),
            { productId: product.id, cacheKey, channel: ch }
        );
        let body = sanitizeAiBodyText(polishAiBody(String(raw || '').trim(), product.name), {
            productName: product.name,
        });
        if (!body && raw) body = recoverPromoBody(raw, product.name);
        if (!body) {
            const { descBudgetForPromo, WA_STATUS_CAPTION_MAX } = require('./promoTextLimits');
            const prefix = `✨ ${product.name}\n\n`;
            const suffix = `💰 Por apenas ${price.precoLabel}\n⏳ Estoque digital limitado…\n🛒 Garanta agora:`;
            const descMax = descBudgetForPromo(prefix, suffix, WA_STATUS_CAPTION_MAX);
            body = polishAiBody(
                trimDesc(getProductPromoBody(product) || product.description || '', descMax),
                product.name
            );
        }

        const plain = buildWaPlainFromParts({
            productName: product.name,
            body,
            priceLabel: price.precoLabel,
            hasSale: price.hasSale,
            originalPrice: formatBrl(Number(product.price)),
            botLink,
        });

        if (plain.length > 40) {
            logger.info('[AI_COPY] WA plain generated', {
                productId: product.id,
                angle: angle.id,
                stableCopy,
            });
            return prepareWaPromoPlain(plain, {
                productName: product.name,
                productId: product.id,
                username,
            });
        }
    } catch (e) {
        const reason = e?.message || 'api_error';
        const quiet =
            e?.code === 'GATEWAY_OUTAGE' ||
            /429|502|503|504|gateway|indisponíveis|rate limit|cooldown|boot guard/i.test(reason);
        const logFn = quiet ? logger.debug.bind(logger) : logger.warn.bind(logger);
        logFn('[AI_COPY] WA fallback template', {
            productId: product.id,
            reason,
        });
    } finally {
        _generatingDepth = Math.max(0, _generatingDepth - 1);
    }

    return buildWaPlainPromo(product, { sale, username });
}

/**
 * Texto livre (admin → broadcast IA).
 */
async function generateThemePromoHtml(theme, options = {}) {
    const { dbRaw = null } = options;
    if (!ZeroTwoAi.isConfigured() || shouldDeferAi()) return null;

    const variationIndex = dbRaw ? bumpVariationIndex(dbRaw) : Date.now();
    const angle = pickAngle(variationIndex);
    let stats = null;
    if (dbRaw) {
        try {
            const db = dbRaw();
            const prods = db.prepare('SELECT COUNT(*) as c FROM products WHERE active = 1').get();
            const users = db.prepare('SELECT COUNT(*) as c FROM users').get();
            stats = { products: prods?.c || 0, users: users?.c || 0 };
        } catch {
            /* ignore */
        }
    }

    try {
        const raw = await ZeroTwoAi.callGptApi(
            buildThemeAiQuery(theme, {
                angle,
                botName: process.env.BOT_DISPLAY_NAME || 'Hanork',
                stats,
            })
        );
        let text = sanitizeAiBodyText(
            String(raw || '').trim().replace(/\*\*/g, '').replace(/\*/g, '')
        );
        text = polishPromoHtml(sanitizeTelegramHtml(text), {});
        if (text.length > 30 && isTelegramHtmlBalanced(text)) {
            logger.info('[AI_COPY] campaign optimized', { angle: angle.id, variationIndex, theme: true });
            return text;
        }
    } catch (e) {
        logger.info('[AI_COPY] fallback template (tema)', { theme: true, reason: e.message });
    }
    return null;
}

module.exports = {
    isAiBroadcastEnabled,
    isAiAvailableNow,
    shouldDeferAiForChannel,
    generateProductPromoHtml,
    generateProductPromoPlain,
    generateThemePromoHtml,
    PROMO_ANGLES,
};
