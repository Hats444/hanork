'use strict';

const PLATFORM_HOSTS = {
    Instagram: ['instagram.com', 'instagr.am'],
    TikTok: ['tiktok.com'],
    YouTube: ['youtube.com', 'youtu.be'],
    Telegram: ['t.me', 'telegram.me', 'telegram.org'],
    Facebook: ['facebook.com', 'fb.com', 'fb.watch'],
    Discord: ['discord.gg', 'discord.com'],
    Spotify: ['spotify.com', 'open.spotify.com'],
    Twitch: ['twitch.tv'],
    Twitter: ['twitter.com', 'x.com'],
    Kwai: ['kwai.com', 'k.kwai.com'],
};

function validateGenericUrlHost(hostname) {
    const host = String(hostname || '').replace(/^www\./, '').toLowerCase();
    if (host.length < 4 || !host.includes('.')) return 'link_invalid';
    if (/^[\d.]+$/.test(host)) return 'link_invalid';
    return null;
}

function validateUrlLink(link, platform) {
    const raw = String(link || '').trim();
    if (!/^https?:\/\//i.test(raw)) {
        return 'link_invalid';
    }
    if (raw.length > 2048) return 'link_invalid';
    try {
        const u = new URL(raw);
        const hosts = PLATFORM_HOSTS[platform];
        if (hosts?.length) {
            const host = u.hostname.replace(/^www\./, '').toLowerCase();
            const ok = hosts.some((h) => host === h || host.endsWith(`.${h}`));
            if (!ok) return 'link_platform_mismatch';
        } else {
            const genericErr = validateGenericUrlHost(u.hostname);
            if (genericErr) return genericErr;
        }
    } catch {
        return 'link_invalid';
    }
    return null;
}

function validateTextTarget(text) {
    const raw = String(text || '').trim();
    if (/^https?:\/\//i.test(raw)) {
        return 'target_use_text_not_url';
    }
    if (raw.length < 3) return 'target_too_short';
    return null;
}

/**
 * @param {string} value
 * @param {string} platform
 * @param {'url'|'text'} mode
 */
function validateTargetInput(value, platform, mode = 'url') {
    if (mode === 'text') {
        return validateTextTarget(value);
    }
    return validateUrlLink(value, platform);
}

/** @deprecated use validateTargetInput */
function validateLink(link, platform) {
    return validateUrlLink(link, platform);
}

function validateComments(comments, quantity) {
    const raw = String(comments || '').trim();
    if (!raw) return 'comments_required';
    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return 'comments_required';
    const qty = Number(quantity);
    if (Number.isFinite(qty) && qty > 0 && lines.length !== qty) {
        return 'comments_count_mismatch';
    }
    return null;
}

module.exports = {
    validateLink,
    validateTargetInput,
    validateTextTarget,
    validateComments,
};
