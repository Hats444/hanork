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

function classifySubcategory(name) {
    return matchFirst(name, SUBCATEGORY_RULES, 'Outros');
}

function classifyService(raw) {
    const name = raw.name || raw.service_name || '';
    const categoryRaw = raw.category || '';
    return {
        platform: classifyPlatform(name, categoryRaw),
        subcategory: classifySubcategory(name),
        category_raw: categoryRaw,
    };
}

module.exports = {
    classifyPlatform,
    classifySubcategory,
    classifyService,
};
