'use strict';

const fs = require('fs');
const path = require('path');
const { isUsablePhotoUrl } = require('./messageDelivery');
const { getMenuPhotoInput } = require('./menuPhoto');
const { isValidScreenImageFile } = require('../utils/imageFileValidation');

const ASSETS_DIR = path.join(__dirname, '../../assets/images');

/** Telas suportadas — arquivo esperado: assets/images/{nome}.jpg */
const SCREEN_FILES = {
    home: 'home',
    instagram: 'instagram',
    tiktok: 'tiktok',
    youtube: 'youtube',
    telegram: 'telegram',
    facebook: 'facebook',
    discord: 'discord',
    spotify: 'spotify',
    twitter: 'twitter',
    twitch: 'twitch',
    kwai: 'kwai',
    outros: 'home',
    wallet: 'wallet',
    cashback: 'cashback',
    affiliate: 'affiliate',
    orders: 'orders',
    support: 'support',
    terms: 'support',
    smm: 'home',
    wa_divulgacao: 'telegram',
    virtuo: 'telegram',
};

const PLATFORM_SCREEN = {
    Instagram: 'instagram',
    TikTok: 'tiktok',
    YouTube: 'youtube',
    Telegram: 'telegram',
    Facebook: 'facebook',
    Discord: 'discord',
    Spotify: 'spotify',
    Twitch: 'twitch',
    Twitter: 'twitter',
    Kwai: 'kwai',
    Outros: 'home',
};

const EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

function resolveAssetsDirs() {
    const dirs = [];
    const env = process.env.HANORK_ASSETS_IMAGES?.trim();
    if (env) dirs.push(path.normalize(env));
    try {
        const cfg = require('../config/config');
        if (cfg.CAMINHO_ASSETS_IMAGES) dirs.push(path.normalize(cfg.CAMINHO_ASSETS_IMAGES));
    } catch {
        /* ignore */
    }
    dirs.push(path.normalize(ASSETS_DIR));
    dirs.push(path.normalize(path.join(process.cwd(), 'assets', 'images')));
    return [...new Set(dirs.filter(Boolean))];
}

function findScreenFile(screenKey) {
    const base = SCREEN_FILES[screenKey] || SCREEN_FILES.home;
    for (const dir of resolveAssetsDirs()) {
        if (!dir || !fs.existsSync(dir)) continue;
        for (const ext of EXTENSIONS) {
            const fp = path.join(dir, `${base}${ext}`);
            try {
                if (isValidScreenImageFile(fp)) return fp;
            } catch {
                /* ignore */
            }
        }
    }
    return null;
}

/** Lista capas válidas em assets/images (para log de boot). */
function listValidScreenFiles() {
    const seen = new Set();
    const out = [];
    for (const dir of resolveAssetsDirs()) {
        if (!dir || !fs.existsSync(dir)) continue;
        let names;
        try {
            names = fs.readdirSync(dir);
        } catch {
            continue;
        }
        for (const name of names) {
            if (!/\.(jpe?g|png|webp)$/i.test(name)) continue;
            const fp = path.normalize(path.join(dir, name));
            if (seen.has(fp)) continue;
            seen.add(fp);
            if (isValidScreenImageFile(fp)) out.push(fp);
        }
    }
    return out.sort();
}

function screenFromPlatform(platform) {
    if (!platform) return 'home';
    return PLATFORM_SCREEN[platform] || 'home';
}

/**
 * Foto contextual para uma tela do bot.
 * @param {string} screen — chave em SCREEN_FILES (ex. 'instagram', 'orders')
 * @param {number|string|null} [userId] — rotação de fallback menu
 */
function getScreenPhotoInput(screen = 'home', userId = null) {
    const url = process.env[`SCREEN_PHOTO_URL_${String(screen).toUpperCase()}`]?.trim();
    if (url && isUsablePhotoUrl(url)) return url;

    const fp = findScreenFile(screen);
    if (fp) return { source: fp };

    return getMenuPhotoInput(userId, `screen:${screen}`);
}

function getPlatformPhotoInput(platform, userId = null) {
    return getScreenPhotoInput(screenFromPlatform(platform), userId);
}

module.exports = {
    SCREEN_FILES,
    PLATFORM_SCREEN,
    screenFromPlatform,
    getScreenPhotoInput,
    getPlatformPhotoInput,
    resolveAssetsDirs,
    findScreenFile,
    listValidScreenFiles,
};
