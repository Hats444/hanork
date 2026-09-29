'use strict';

const { FEATURED_SERVICES } = require('../constants/featuredServices');

const SERVICE_ALIASES = Object.freeze({
    wa: ['whatsapp', 'whats', 'zap', 'wpp'],
    tg: ['telegram', 'telegran'],
    ig: ['instagram', 'insta'],
    dc: ['discord'],
    fb: ['facebook', 'face'],
    go: ['google', 'gmail'],
    tw: ['twitter', 'x'],
    lf: ['tiktok', 'tik tok'],
    nf: ['netflix'],
    ub: ['uber'],
    am: ['amazon'],
});

function norm(s) {
    return String(s || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

/** @returns {{ serviceCode: string|null, countryQuery: string|null, raw: string }} */
function parseVirtuoQuery(text) {
    const raw = String(text || '').trim();
    let remainder = norm(raw);
    let serviceCode = null;

    for (const svc of FEATURED_SERVICES) {
        const aliases = [svc.code, svc.name, ...(SERVICE_ALIASES[svc.code] || [])].map(norm);
        for (const alias of aliases.sort((a, b) => b.length - a.length)) {
            if (!alias || alias.length < 2) continue;
            const re = new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
            if (re.test(remainder)) {
                serviceCode = svc.code;
                remainder = remainder.replace(re, ' ').replace(/\s+/g, ' ').trim();
                break;
            }
        }
        if (serviceCode) break;
    }

    const countryQuery = remainder.length >= 2 ? remainder : null;
    return { serviceCode, countryQuery, raw };
}

module.exports = { parseVirtuoQuery, norm };
