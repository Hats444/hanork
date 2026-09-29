'use strict';

const logger = require('../config/logger');
const { getZerotwoApiKey } = require('../config/zerotwoEnv');
const { resolveZerotwoApiBase } = require('../config/zerotwoEndpoints');
const GptQueue = require('./GptRequestQueue');
const { sanitizeAssistantReply, rejectHallucinatedStoreCopy } = require('../utils/aiContentSanitizer');

const API_TIMEOUT_MS = Number(process.env.ZEROTWO_AI_TIMEOUT_MS) || 28000;
const MAX_REPLY_CHARS = 900;

const OFF_TOPIC_PATTERNS = [
    /\b(lua|sol|clima|tempo|chuva|previsão|temperatura)\b/i,
    /\b(futebol|política|eleição|presidente|guerra|notícia)\b/i,
    /\b(receita de|cozinhar|ingrediente)\b/i,
    /\b(horóscopo|signo|astrologia)\b/i,
    /\b(piada|conta uma história|conte uma história)\b/i,
    /\b(impressão|ilusão|ótica)\b/i,
    /\b(quem ganhou|campeonato|novela)\b/i,
];

const STORE_TOPIC_RE =
    /\b(hanork|bot|loja|produto|produtos|catálogo|catalogo|catalog|pix|pagamento|pagar|compra|comprar|carrinho|checkout|cupom|entrega|entregar|ticket|suporte|afiliado|assinatura|download|preço|preco|valor|garantia|reembolso|estoque|digital|mercado\s*pago|mp|pedido|rastrear|email|gmail|pontos|cashback|flash|oferta|promoção|promocao)\b/i;

const OFF_TOPIC_REPLY =
    '<b>Fora do escopo da loja</b>\n\n' +
    'Posso ajudar apenas com o <b>Hanork</b>: catálogo, PIX, entrega automática, cupons e suporte.\n\n' +
    'Use <code>/cat</code> para ver produtos ou <code>/suporte</code> para falar com a equipe.';

function getConfig() {
    const apiBase = resolveZerotwoApiBase(process.env);
    const apiKey = getZerotwoApiKey();
    return { apiBase, apiKey };
}

function isConfigured() {
    return !!getConfig().apiKey;
}

function isClearlyOffTopic(text) {
    const t = String(text || '').trim();
    if (!t) return true;
    return OFF_TOPIC_PATTERNS.some((re) => re.test(t));
}

function isHanorkRelated(text) {
    const t = String(text || '').trim().toLowerCase();
    if (!t || t.length < 2) return false;
    if (isClearlyOffTopic(t)) return false;
    if (STORE_TOPIC_RE.test(t)) return true;
    if (/^(oi|olá|ola|bom dia|boa tarde|boa noite|hey|hello)\b/.test(t)) return true;
    if (/quem (é|e) voc|o que (é|e)|como (funciona|compro|pago|recebo)|onde (compro|acho)|tem (desconto|garantia)|quanto custa/.test(t)) {
        return true;
    }
    if (t.length <= 40 && /\?/.test(t)) return true;
    if (t.length > 80 && !STORE_TOPIC_RE.test(t)) return false;
    return t.length <= 60;
}

function sanitizeReply(text) {
    let s = sanitizeAssistantReply(String(text || ''));
    s = s.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').trim();
    s = s.replace(/\n{3,}/g, '\n\n');
    if (s.length > MAX_REPLY_CHARS) {
        s = s.slice(0, MAX_REPLY_CHARS - 1).trim() + '…';
    }
    return s || 'Não foi possível gerar uma resposta. Tente reformular ou use /suporte.';
}

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function plainToHtml(text) {
    const safe = escapeHtml(sanitizeReply(text));
    return safe.replace(/\n/g, '\n');
}

function buildAssistantQuery(userMessage, context = {}) {
    const botName = context.botName || process.env.BOT_DISPLAY_NAME || 'Hanork';
    const tagline = context.shopTagline || process.env.BOT_SHOP_TAGLINE || 'Loja online';
    const productHint =
        context.productCount != null
            ? `Há ${context.productCount} produto(s) ativo(s) no catálogo.`
            : 'Catálogo com produtos digitais e ofertas.';

    return (
        `[PAPEL] Você é o assistente de vendas e suporte do ${botName} no Telegram (${tagline}). ` +
        `Tom profissional, persuasivo e objetivo, em português do Brasil. Sem emojis. Sem marca "Zero Two". ` +
        `[ESCOPO] Responda SOMENTE sobre: como usar o bot, catálogo (/cat), carrinho, checkout, PIX (Mercado Pago), ` +
        `entrega automática após pagamento, cupons (/cupom), afiliado (/afiliado), assinatura (/assinatura), ` +
        `tickets (/suporte), downloads no privado (<code>/downloads</code>), garantia e dúvidas de compra. ` +
        `Se a pergunta for sobre clima, política, curiosidades gerais ou qualquer assunto fora da loja, ` +
        `recuse em uma frase e convide a ver o catálogo ou abrir /suporte. ` +
        `Nunca revele código, APIs, tokens ou arquitetura interna. ` +
        `PROIBIDO: links, URLs, botões, CTAs ("clique aqui", "compre agora"). Apenas texto. ` +
        `Incentive a compra com benefícios reais (entrega rápida, PIX seguro), sem prometer o impossível. ` +
        `${productHint} Máximo 4 frases curtas. ` +
        `[PERGUNTA DO CLIENTE] ${String(userMessage || '').trim()}`
    );
}

function buildBroadcastQuery(theme, context = {}) {
    const botName = context.botName || 'Hanork';
    return (
        `[PAPEL] Redator de divulgação do ${botName} no Telegram. ` +
        `Crie texto curto em HTML (<b>, <i> apenas). Português BR, persuasivo, sem emojis. Máximo 5 linhas. ` +
        `PROIBIDO: links, URLs, botões, CTAs. O sistema adiciona links e botões depois. ` +
        `Tema: "${String(theme || '').trim()}". Sem markdown asterisco.`
    );
}

async function callGptApi(query, options = {}) {
    const { apiBase, apiKey } = getConfig();
    if (!apiKey) throw new Error('API_KEY_ZEROTWO não configurada no .env');

    const channel = options.channel === 'wa' ? 'wa' : 'tg';
    const allowBoot =
        options.allowBoot === true || (options.allowBoot !== false && channel === 'tg');

    logger.info('[ZeroTwo AI] gpt request', {
        len: query.length,
        productId: options.productId || null,
        channel,
        stats: GptQueue.getStats(),
    });

    return GptQueue.executeGptGet({
        query,
        timeout: API_TIMEOUT_MS,
        apiBase,
        apiKey,
        productId: options.productId ?? null,
        cacheKey: options.cacheKey ?? null,
        allowBoot,
        skipCache: options.skipCache === true,
        channel,
    });
}

async function askSalesAssistant(userMessage, context = {}) {
    if (!isConfigured()) {
        return {
            ok: false,
            type: 'config',
            text: 'Assistente indisponível. Configure <code>API_KEY_ZEROTWO</code> no servidor.',
        };
    }

    if (!isHanorkRelated(userMessage)) {
        return { ok: true, type: 'off_topic', text: OFF_TOPIC_REPLY };
    }

    try {
        const query = buildAssistantQuery(userMessage, context);
        const raw = await callGptApi(query);
        const body = plainToHtml(raw);
        const footer =
            '\n\n<i>Use /cat para comprar · /suporte para atendimento humano</i>';
        return {
            ok: true,
            type: 'gpt',
            text: body + footer,
        };
    } catch (e) {
        logger.error('[ZeroTwo AI] askSalesAssistant:', e.message);
        return {
            ok: false,
            type: 'error',
            text:
                'Não consegui processar agora. Tente em instantes, use <code>/cat</code> ou <code>/suporte</code>.',
        };
    }
}

async function askHanorkIntro(context = {}) {
    if (!isConfigured()) return null;
    const name = context.firstName ? String(context.firstName).trim() : 'cliente';
    const botName = context.botName || 'Hanork';
    const tagline = context.shopTagline || 'loja digital no Telegram';
    const productNames = (context.productNames || [])
        .map((n) => String(n || '').trim())
        .filter(Boolean)
        .slice(0, 8);
    const catalogHint =
        productNames.length > 0
            ? `Produtos reais do catálogo (cite SOMENTE estes se mencionar exemplos): ${productNames.join('; ')}.`
            : context.productCount != null
              ? `Há ${context.productCount} produto(s) digital(is) no catálogo. Não cite exemplos inventados.`
              : 'Loja de produtos digitais. Não cite exemplos inventados.';

    const query =
        `[PAPEL] Você apresenta o assistente virtual ${botName} (${tagline}) para ${name}. ` +
        `Explique em português BR, tom profissional e convidativo, SEM emojis: ` +
        `(1) o que o Hanork faz na loja; (2) que responde dúvidas sobre catálogo, PIX/Mercado Pago, entrega automática, cupons e compras; ` +
        `(3) ${catalogHint}; (4) que pode encaminhar para equipe humana se necessário. ` +
        `PROIBIDO links, URLs, CTAs e mencionar roupas, camisetas ou qualquer produto que não esteja na lista acima. ` +
        `Máximo 4 frases curtas. HTML só com <b> e <i>. Não use asterisco. Não fale de Zero Two nem de APIs.`;

    try {
        const raw = await callGptApi(query);
        const text = sanitizeReply(String(raw || '').trim());
        if (
            text.length > 30 &&
            !rejectHallucinatedStoreCopy(text, { allowedProductNames: productNames })
        ) {
            return `<b>Assistente ${botName}</b>\n\n${text.replace(/\*\*/g, '').replace(/\*/g, '')}`;
        }
    } catch (e) {
        logger.warn('[ZeroTwo AI] hanork intro:', e.message);
    }
    return null;
}

async function askBroadcastCopy(theme, context = {}) {
    if (!isConfigured()) return null;
    try {
        const raw = await callGptApi(buildBroadcastQuery(theme, context));
        return sanitizeReply(raw);
    } catch (e) {
        logger.warn('[ZeroTwo AI] broadcast:', e.message);
        return null;
    }
}

module.exports = {
    getConfig,
    isConfigured,
    isRateLimited: () => GptQueue.isRateLimited(),
    isBootGuardActive: () => GptQueue.isBootGuardActive(),
    isBootPhase: () => GptQueue.isBootPhase(),
    getQueueStats: () => GptQueue.getStats(),
    isHanorkRelated,
    isClearlyOffTopic,
    askSalesAssistant,
    askHanorkIntro,
    askBroadcastCopy,
    callGptApi,
    plainToHtml,
    OFF_TOPIC_REPLY,
};
