'use strict';

/** Apps prioritários no hub (sync completo vem da API). */
const FEATURED_SERVICES = Object.freeze([
    { code: 'wa', emoji: '💬', name: 'WhatsApp' },
    { code: 'tg', emoji: '✈️', name: 'Telegram' },
    { code: 'ig', emoji: '📸', name: 'Instagram' },
    { code: 'dc', emoji: '🎮', name: 'Discord' },
    { code: 'fb', emoji: '👤', name: 'Facebook' },
    { code: 'go', emoji: '🔍', name: 'Google' },
    { code: 'tw', emoji: '🐦', name: 'Twitter / X' },
    { code: 'lf', emoji: '🎵', name: 'TikTok' },
    { code: 'nf', emoji: '🎬', name: 'Netflix' },
    { code: 'ub', emoji: '🚗', name: 'Uber' },
    { code: 'am', emoji: '📦', name: 'Amazon' },
]);

function featuredByCode(code) {
    return FEATURED_SERVICES.find((s) => s.code === String(code || '').toLowerCase()) || null;
}

module.exports = { FEATURED_SERVICES, featuredByCode };
