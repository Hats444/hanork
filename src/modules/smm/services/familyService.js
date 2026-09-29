'use strict';

const { isCatalogHealth } = require('../constants/serviceHealthStatuses');

/**
 * Agrupa serviços do fornecedor em famílias comerciais (V2 onda A).
 * Ex.: "Instagram Seguidores BR #01" e "Instagram Followers Brasileiros" → instagram_seguidores_br
 */

const REGION_TAGS = [
    { tag: 'br', patterns: [/\bbr\b/i, /brasil/i, /brazil/i, /brasileir/i, /brazilian/i] },
    { tag: 'global', patterns: [/mundial/i, /worldwide/i, /\bglobal\b/i, /internacional/i] },
    { tag: 'us', patterns: [/\busa\b/i, /\bus\b/i, /america/i, /estados\s*unidos/i] },
    { tag: 'latam', patterns: [/latam/i, /latin/i, /hispan/i] },
];

/** Ruído removido antes de deduplicar nomes parecidos */
const NAME_NOISE = [
    /\b(servi[cç]o|service)\s*#?\d+\b/gi,
    /\b#\d+\b/g,
    /\b(v\d+|vip+|premium|hq|high\s*quality|best|top|super|ultra|mega)\b/gi,
    /\b(novo|new|old|test|demo|sample|promo)\b/gi,
    /\b(real|reais?|instant|instantâneo|rápido|fast|slow|barato|cheap|refill)\b/gi,
    /\b(instagram|insta|tiktok|youtube|facebook|telegram|twitter|twitch|discord|spotify|kwai)\b/gi,
    /\b(seguidor\w*|followers?|curtida\w*|likes?|views?|visualiza\w*|coment\w*|shares?|members?|membros?|inscrit\w*|stories?|lives?|reaç\w*|reactions?)\b/gi,
    /[\[\](){}\-–—|•★☆⚡🔥💎✅❌]/g,
];

function slugify(text) {
    return String(text || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '')
        || 'outros';
}

function extractRegionTag(name) {
    const hay = String(name || '');
    for (const { tag, patterns } of REGION_TAGS) {
        if (patterns.some((p) => p.test(hay))) return tag;
    }
    return 'any';
}

function normalizeServiceName(name) {
    let s = String(name || '').toLowerCase();
    s = s.normalize('NFD').replace(/\p{M}/gu, '');
    for (const p of NAME_NOISE) {
        s = s.replace(p, ' ');
    }
    return s.replace(/\s+/g, ' ').trim();
}

/**
 * @param {{ platform: string, subcategory: string, name: string }} input
 * @returns {string} ex. instagram_seguidores_br
 */
function deriveServiceFamily({ platform, subcategory, name }) {
    const plat = slugify(platform || 'outros');
    const sub = slugify(subcategory || 'outros');
    const region = extractRegionTag(name);
    return `${plat}_${sub}_${region}`;
}

/**
 * Score estático (onda A). Onda B adiciona histórico de pedidos (+40 taxa sucesso).
 * @param {object} row
 * @param {number} [minCostInFamily] menor cost_price da família (opcional)
 */
function computeStaticServiceScore(row, minCostInFamily = null) {
    let score = 0;
    if (row.refill) score += 20;
    if (row.cancel) score += 10;

    const max = Number(row.max_quantity) || 0;
    if (max >= 100000) score += 10;
    else if (max >= 10000) score += 5;

    const cost = Number(row.cost_price);
    if (Number.isFinite(cost) && cost > 0) {
        const ref = minCostInFamily != null && minCostInFamily > 0 ? minCostInFamily : cost;
        if (cost <= ref * 1.02) score += 20;
        else if (cost <= ref * 1.1) score += 10;
    }

    return score;
}

/** Recalcula scores com contexto de família (menor custo por família). */
function scoreRowsInFamily(rows) {
    if (!rows?.length) return [];
    const minCost = Math.min(...rows.map((r) => Number(r.cost_price) || Infinity));
    const safeMin = Number.isFinite(minCost) ? minCost : null;
    return rows.map((r) => ({
        ...r,
        service_score: computeStaticServiceScore(r, safeMin),
    }));
}

/** Rótulo comercial para o cliente (sem expor IDs do fornecedor). */
const REGION_LABELS = {
    br: 'Brasileiros',
    global: 'Mundial',
    us: 'EUA',
    latam: 'Latam',
    any: '',
};

function familyDisplayLabel(serviceFamily, subcategory) {
    const sub = String(subcategory || 'Serviço').trim();
    const parts = String(serviceFamily || '').split('_').filter(Boolean);
    const region = parts.length ? parts[parts.length - 1] : 'any';
    const regionLabel = REGION_LABELS[region];
    if (regionLabel && region !== 'any') {
        return `${sub} ${regionLabel}`;
    }
    return sub;
}

function isBetterServiceCandidate(a, b) {
    const sa = Number(a?.service_score) || 0;
    const sb = Number(b?.service_score) || 0;
    if (sa !== sb) return sa > sb;
    return Number(a?.cost_price) < Number(b?.cost_price);
}

function pickBestPerFamily(rows) {
    const byFamily = new Map();
    for (const row of rows || []) {
        if (!isCatalogHealth(row)) continue;
        const fam = row.service_family || `id_${row.id}`;
        const prev = byFamily.get(fam);
        if (!prev || isBetterServiceCandidate(row, prev)) {
            byFamily.set(fam, row);
        }
    }
    return [...byFamily.values()].sort((a, b) => {
        const ds = (Number(b.service_score) || 0) - (Number(a.service_score) || 0);
        if (ds !== 0) return ds;
        return String(a.name).localeCompare(String(b.name), 'pt-BR');
    });
}

module.exports = {
    deriveServiceFamily,
    extractRegionTag,
    normalizeServiceName,
    computeStaticServiceScore,
    scoreRowsInFamily,
    slugify,
    familyDisplayLabel,
    REGION_LABELS,
    isBetterServiceCandidate,
    pickBestPerFamily,
};
