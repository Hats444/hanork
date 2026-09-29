'use strict';

const PLATFORM_RULES = [
    { platform: 'Instagram', patterns: [/instagram/i, /\binsta\b/i, /\big\b/i, /\breels?\b/i] },
    { platform: 'TikTok', patterns: [/tiktok/i, /\btik\s*tok\b/i] },
    { platform: 'YouTube', patterns: [/youtube/i, /\byt\b/i] },
    { platform: 'Telegram', patterns: [/telegram/i, /\btg\b/i] },
    { platform: 'Facebook', patterns: [/facebook/i, /\bfb\b/i] },
    { platform: 'Discord', patterns: [/discord/i] },
    { platform: 'Spotify', patterns: [/spotify/i] },
    { platform: 'Twitch', patterns: [/twitch/i] },
    { platform: 'Twitter', patterns: [/twitter/i, /\bx\.com\b/i] },
    { platform: 'Kwai', patterns: [/kwai/i] },
    { platform: 'Free Fire', patterns: [/free\s*fire/i, /freefire/i, /\bff\b/i, /garena/i] },
    { platform: 'IPTV', patterns: [/\biptv\b/i, /painel\s*de\s*iptv/i] },
];

const PLATFORMS_DISPLAY_ORDER = [
    'Instagram', 'TikTok', 'YouTube', 'Telegram', 'Facebook',
    'Discord', 'Spotify', 'Twitch', 'Twitter', 'Kwai',
    'Free Fire', 'IPTV', 'Outros',
];

module.exports = { PLATFORM_RULES, PLATFORMS_DISPLAY_ORDER };
