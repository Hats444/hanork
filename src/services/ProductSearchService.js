'use strict';

/**
 * Busca universal no catálogo — qualquer produto cadastrado (nome, descrição, categoria, formato).
 * Usado por: catálogo Telegram, Hanork product_search, recomendações e modo 🔍 Buscar.
 */

const { resolveProductFormat } = require('../utils/productFormat');
const { sanitizeProductSearchQuery, lightNorm, normalizeRawSearchQuery } = require('./hanork-ai/HanorkNlExtractors');

const QUERY_STOP = new Set([
    'que', 'quem', 'como', 'onde', 'quando', 'qual', 'quais', 'voce', 'você', 'vc',
    'me', 'recomenda', 'recomendar', 'indica', 'indicar', 'melhor', 'produto', 'produtos',
    'loja', 'bot', 'catalogo', 'catálogo', 'algo', 'uma', 'coisa', 'coisas',
    'grupos', 'grupo', 'todos', 'em', 'nos', 'nas', 'ok', 'esta', 'está', 'por', 'favor',
    'pelo', 'pela', 'pelos', 'pelas', 'quero', 'comprar', 'preciso', 'busca', 'buscar',
    'procura', 'procurar', 'tem', 'achar', 'ver', 'mostra', 'mostrar', 'abre', 'abrir',
]);

const MIN_TOKEN_LEN = 2;
const DEFAULT_MIN_SCORE = 6;

function splitWords(text) {
    return String(text || '')
        .toLowerCase()
        .split(/[\s|/\\_,\-+()[\]{}]+/)
        .map((w) => w.replace(/[^\w\u00C0-\u024F]/gi, ''))
        .filter((w) => w.length >= MIN_TOKEN_LEN);
}

function fileExtHint(product) {
    const url = String(product?.file_url || product?.fileUrl || '');
    const m = url.match(/\.([a-z0-9]{2,8})(?:\?|$)/i);
    return m ? m[1].toLowerCase() : '';
}

function buildProductProfile(product) {
    const fmt = resolveProductFormat(product);
    const ext = fileExtHint(product);
    const name = String(product?.name || '');
    const description = String(product?.description || '');
    const category = String(product?.category || '');
    const nameWords = splitWords(name);
    const nameNorm = lightNorm(name);
    const descNorm = lightNorm(description);
    const catNorm = lightNorm(category);
    const haystack = lightNorm(`${name} ${description} ${category} ${fmt || ''} ${ext}`);

    return {
        name,
        nameNorm,
        nameWords,
        descNorm,
        catNorm,
        fmt: lightNorm(fmt || ''),
        ext,
        haystack,
    };
}

function tokenizeQuery(query) {
    const sanitized = sanitizeProductSearchQuery(query);
    const base = sanitized || lightNorm(query);
    if (!base) return [];

    const idMatch = base.match(/^(?:#|id\s*)?(\d{1,8})$/);
    if (idMatch) return [{ type: 'id', value: idMatch[1] }];

    const words = base
        .split(/\s+/)
        .map((w) => w.trim())
        .filter((w) => w.length >= MIN_TOKEN_LEN && !QUERY_STOP.has(w));

    return words.map((value) => ({ type: 'term', value }));
}

function wordMatchesToken(word, token) {
    if (!word || !token) return false;
    if (word === token) return true;
    if (word.startsWith(token) || token.startsWith(word)) return true;
    if (word.includes(token) || token.includes(word)) return true;
    return false;
}

function scoreToken(profile, token) {
    let score = 0;
    const t = token.toLowerCase();

    for (const word of profile.nameWords) {
        if (word === t) score += 40;
        else if (word.startsWith(t) || t.startsWith(word)) score += 28;
        else if (word.includes(t) || t.includes(word)) score += 18;
    }

    if (profile.nameNorm === t) score += 100;
    else if (profile.nameNorm.includes(t)) score += 35;

    if (profile.catNorm.includes(t)) score += 14;
    if (profile.descNorm.includes(t)) score += 10;
    if (profile.ext === t) score += 22;
    if (profile.fmt.includes(t) || profile.ext === t) score += 8;
    if (profile.haystack.includes(t)) score += 4;

    return score;
}

function scoreProduct(product, queryTokens, rawQuery) {
    const profile = buildProductProfile(product);
    const raw = lightNorm(rawQuery);
    let score = 0;
    let matchedTerms = 0;

    for (const tok of queryTokens) {
        if (tok.type === 'id') {
            if (String(product.id) === tok.value) return 200;
            continue;
        }
        const s = scoreToken(profile, tok.value);
        if (s > 0) {
            matchedTerms += 1;
            score += s;
        }
    }

    if (queryTokens.length > 1 && matchedTerms === queryTokens.length) {
        score += 25;
    }

    if (raw && profile.nameNorm.includes(raw)) {
        score += 30;
    }

    if (/\bbarat|econom|menor\b/.test(raw)) {
        score -= Number(product.price || 0) * 0.015;
    }
    if (/\bmelhor|premium|top|qualidade\b/.test(raw)) {
        score += Number(product.price || 0) * 0.015;
    }

    return score;
}

function activeInStock(products) {
    return (products || []).filter(
        (p) => p && p.active !== false && Number(p.stock ?? 999) > 0
    );
}

/**
 * @param {object[]} products
 * @param {string} query
 * @param {{ limit?: number, minScore?: number, relax?: boolean }} opts
 */
function searchProducts(products, query, opts = {}) {
    const raw = String(query || '').trim();
    const tokens = tokenizeQuery(raw);
    const list = activeInStock(products);
    const minScore = opts.minScore ?? DEFAULT_MIN_SCORE;
    const limit = opts.limit ?? 0;

    if (!raw || !tokens.length) {
        return { query: raw, tokens: [], results: [], scores: [] };
    }

    let scored = list
        .map((product) => ({
            product,
            score: scoreProduct(product, tokens, raw),
        }))
        .filter((x) => x.score >= minScore)
        .sort((a, b) => b.score - a.score || Number(b.product.id) - Number(a.product.id));

    if (!scored.length && opts.relax !== false && tokens.length > 1) {
        const relaxedMin = Math.max(4, minScore - 4);
        scored = list
            .map((product) => {
                let score = 0;
                for (const tok of tokens) {
                    if (tok.type === 'id') continue;
                    if (scoreToken(buildProductProfile(product), tok.value) > 0) score += 1;
                }
                return { product, score };
            })
            .filter((x) => x.score > 0)
            .sort((a, b) => b.score - a.score)
            .map((x) => ({ ...x, score: x.score * relaxedMin }));
    }

    if (limit > 0) scored = scored.slice(0, limit);

    return {
        query: raw,
        tokens: tokens.map((t) => t.value || t.type),
        results: scored.map((x) => x.product),
        scores: scored.map((x) => ({ id: x.product.id, score: Math.round(x.score) })),
    };
}

function filterProducts(products, query) {
    return searchProducts(products, query).results;
}

function pickProducts(products, query, limit = 1) {
    const { results } = searchProducts(products, query, { limit, minScore: 4 });
    return results;
}

/** Texto digitado direto no modo 🔍 Buscar (sem frase NL). */
function normalizeRawQuery(text) {
    return normalizeRawSearchQuery(text);
}

module.exports = {
    searchProducts,
    filterProducts,
    pickProducts,
    normalizeRawQuery,
    tokenizeQuery,
    buildProductProfile,
    scoreProduct,
};
