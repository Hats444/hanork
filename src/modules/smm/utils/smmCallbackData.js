'use strict';

const { PLATFORMS_DISPLAY_ORDER } = require('../constants/platforms');
const { SUBCATEGORIES_DISPLAY_ORDER } = require('../constants/subcategories');

const PLATFORM_TO_SLUG = {
    Instagram: 'ig',
    TikTok: 'tt',
    YouTube: 'yt',
    Telegram: 'tg',
    Facebook: 'fb',
    Discord: 'dc',
    Spotify: 'sp',
    Twitch: 'tw',
    Twitter: 'x',
    Kwai: 'kw',
    Outros: 'ot',
    'Free Fire': 'ff',
    IPTV: 'iptv',
};

const SLUG_TO_PLATFORM = Object.fromEntries(
    Object.entries(PLATFORM_TO_SLUG).map(([k, v]) => [v, k])
);

const SUB_TO_SLUG = {
    Seguidores: 'seg',
    Curtidas: 'cur',
    'Visualizações': 'vis',
    'Comentários': 'com',
    Compartilhamentos: 'sha',
    Stories: 'sto',
    Membros: 'mem',
    Inscritos: 'ins',
    'Reações': 'rea',
    Lives: 'liv',
    Outros: 'out',
};

const SLUG_TO_SUB = Object.fromEntries(
    Object.entries(SUB_TO_SLUG).map(([k, v]) => [v, k])
);

const PREFIX = 'smm';

function platformSlug(name) {
    return PLATFORM_TO_SLUG[name] || 'ot';
}

function platformFromSlug(slug) {
    return SLUG_TO_PLATFORM[slug] || 'Outros';
}

function subSlug(name) {
    return SUB_TO_SLUG[name] || 'out';
}

function subFromSlug(slug) {
    return SLUG_TO_SUB[slug] || 'Outros';
}

const CB = {
    HOME: `${PREFIX}:home`,
    platform: (slug) => `${PREFIX}:p:${slug}`,
    sub: (pSlug, sSlug) => `${PREFIX}:s:${pSlug}:${sSlug}`,
    list: (pSlug, sSlug, page) => `${PREFIX}:l:${pSlug}:${sSlug}:${page}`,
    view: (id) => `${PREFIX}:v:${id}`,
    buy: (id) => `${PREFIX}:b:${id}`,
    confirmPay: `${PREFIX}:cp`,
    cancelWizard: `${PREFIX}:wc`,
    wizardLink: (id) => `${PREFIX}:wl:${id}`,
    wizardQty: (id) => `${PREFIX}:wq:${id}`,
    orders: `${PREFIX}:ord`,
    orderView: (id) => `${PREFIX}:o:${id}`,
    refill: (id) => `${PREFIX}:rf:${id}`,
    cancelAsk: (id) => `${PREFIX}:cx:${id}`,
    cancelConfirm: (id) => `${PREFIX}:cx:${id}:y`,
};

const PATTERNS = {
    platform: /^smm:p:([a-z]+)$/,
    sub: /^smm:s:([a-z]+):([a-z]+)$/,
    list: /^smm:l:([a-z]+):([a-z]+):(\d+)$/,
    view: /^smm:v:(\d+)$/,
    buy: /^smm:b:(\d+)$/,
    wizardLink: /^smm:wl:(\d+)$/,
    wizardQty: /^smm:wq:(\d+)$/,
    orderView: /^smm:o:(\d+)$/,
    refill: /^smm:rf:(\d+)$/,
    cancelAsk: /^smm:cx:(\d+)$/,
    cancelConfirm: /^smm:cx:(\d+):y$/,
};

module.exports = {
    PLATFORM_TO_SLUG,
    SLUG_TO_PLATFORM,
    SUB_TO_SLUG,
    SLUG_TO_SUB,
    PLATFORMS_DISPLAY_ORDER,
    SUBCATEGORIES_DISPLAY_ORDER,
    platformSlug,
    platformFromSlug,
    subSlug,
    subFromSlug,
    CB,
    PATTERNS,
};
