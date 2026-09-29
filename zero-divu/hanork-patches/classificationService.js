'use strict';

const { PLATFORM_RULES } = require('../constants/platforms');
const { SUBCATEGORY_RULES } = require('../constants/subcategories');

function matchFirst(text, rules, fallback) {
    const hay = String(text || '');
    for (const rule of rules) {
        for (const pattern of rule.patterns) {
            if (pattern.test(hay)) {
                return rule.platform || rule.subcategory;
            }
        }
    }
    return fallback;
}

function classifyPlatform(name, categoryRaw = '') {
    const combined = `${name} ${categoryRaw}`;
    return matchFirst(combined, PLATFORM_RULES, 'Outros');
}

function classifySubcategory(name, platform = '') {
    const fromName = matchFirst(name, SUBCATEGORY_RULES, null);
    if (fromName) return fromName;
    if (platform === 'IPTV') return 'Assinatura';
    if (platform === 'Free Fire') return 'Pacote';
    if (platform === 'Canva') return 'Assinatura';
    return 'Outros';
}

function classifyService(raw) {
    const name = raw.name || raw.service_name || '';
    const categoryRaw = raw.category || '';
    const platform = classifyPlatform(name, categoryRaw);
    return {
        platform,
        subcategory: classifySubcategory(name, platform),
        category_raw: categoryRaw,
    };
}

module.exports = {
    classifyPlatform,
    classifySubcategory,
    classifyService,
};
