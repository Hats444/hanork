'use strict';

const WaDivulgacaoConfig = require('./waDivulgacaoConfig');
const Copy = require('./waDivulgacaoCopy');

const PLAN_META_PREFIX = 'WA_PLAN_DAYS=';

/** R$ por dia — 1 dia = 4, 5 dias = 20, etc. */
const PRICE_PER_DAY = 4;

const BASE_PLANS = [
    { slug: '1d', days: 1, label: '1 dia' },
    { slug: '5d', days: 5, label: '5 dias' },
    { slug: '10d', days: 10, label: '10 dias' },
    { slug: '15d', days: 15, label: '15 dias' },
    { slug: '30d', days: 30, label: '30 dias' },
    { slug: '60d', days: 60, label: '60 dias' },
];

function defaultPriceForDays(days) {
    return Number(days) * PRICE_PER_DAY;
}

function planEnvPrice(slug, days) {
    const key = `WA_DIVULGACAO_PLAN_${String(slug).toUpperCase()}`;
    const n = Number(process.env[key]);
    if (Number.isFinite(n) && n > 0) return n;
    const perDay = Number(process.env.WA_DIVULGACAO_PRICE_PER_DAY);
    if (Number.isFinite(perDay) && perDay > 0) return days * perDay;
    return defaultPriceForDays(days);
}

function listPlans() {
    return BASE_PLANS.map((p) => ({
        ...p,
        defaultPrice: defaultPriceForDays(p.days),
        price: planEnvPrice(p.slug, p.days),
        name: `📲 ${WaDivulgacaoConfig.displayBrand} · ${p.label}`,
        planName: `${WaDivulgacaoConfig.planPrefix} · ${p.label}`,
        description:
            `${PLAN_META_PREFIX}${p.days}\n` + Copy.formatPlanProductDescription(p.days),
    }));
}

function parsePlanDaysFromProduct(product) {
    if (!product) return 30;
    const desc = String(product.description || '');
    const m = desc.match(/WA_PLAN_DAYS=(\d+)/i);
    if (m) return Math.max(1, parseInt(m[1], 10) || 30);
    const cat = String(product.category || '');
    if (cat.startsWith('wa_divulgacao_')) {
        const d = parseInt(cat.replace('wa_divulgacao_', ''), 10);
        if (d > 0) return d;
    }
    const name = String(product.name || '');
    const m2 = name.match(/(\d+)\s*dia/i);
    if (m2) return Math.max(1, parseInt(m2[1], 10));
    return 30;
}

function isWaDivulgacaoProduct(product) {
    if (!product) return false;
    if (String(product.category || '') === WaDivulgacaoConfig.productCategory) return true;
    if (String(product.category || '').startsWith('wa_divulgacao_')) return true;
    const desc = String(product.description || '');
    if (desc.includes(PLAN_META_PREFIX)) return true;
    const name = String(product.name || '');
    return name.includes('Hanork Div') || name.includes('Zap PRO') || name.includes('WA Divulgação');
}

function isHanorkDivBrand(text) {
    const s = String(text || '');
    return s.includes('Hanork Div') || s.includes('Zap PRO') || s.includes('WA Divulgação');
}

function isWaPlanName(planName) {
    const p = String(planName || '');
    return (
        p.startsWith(WaDivulgacaoConfig.planPrefix) ||
        p.startsWith('WA Divulgação') ||
        p.includes('Zap PRO')
    );
}

module.exports = {
    PLAN_META_PREFIX,
    PRICE_PER_DAY,
    listPlans,
    defaultPriceForDays,
    parsePlanDaysFromProduct,
    isWaDivulgacaoProduct,
    isWaPlanName,
    isHanorkDivBrand,
};
