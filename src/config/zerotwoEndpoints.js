'use strict';

/** Domínios oficiais Zero Two (jul/2026) — ver HANORK-STATUS §7.6 */
const ZEROTWO_API_DEFAULT = 'https://zero-two-apis.store';
const ZEROTWO_UPLOAD_DEFAULT = 'https://uploads.zero-two-apis.store';
const ZEROTWO_YT_API_DEFAULT = 'https://yt-api.zero-two-apis.store';

function resolveZerotwoApiBase(env = process.env) {
    return String(env?.ZEROTWO_API || ZEROTWO_API_DEFAULT).replace(/\/+$/, '');
}

/** Migra links hospedados no domínio antigo (.com.br) → .store */
function migrateZerotwoHostedUrl(url) {
    const s = String(url || '');
    if (!s) return s;
    return s
        .replace(/https?:\/\/uploads\.zero-two-apis\.com\.br/gi, ZEROTWO_UPLOAD_DEFAULT)
        .replace(/https?:\/\/yt-api\.zero-two-apis\.com\.br/gi, ZEROTWO_YT_API_DEFAULT)
        .replace(/https?:\/\/zero-two-apis\.com\.br/gi, ZEROTWO_API_DEFAULT);
}

module.exports = {
    ZEROTWO_API_DEFAULT,
    ZEROTWO_UPLOAD_DEFAULT,
    ZEROTWO_YT_API_DEFAULT,
    resolveZerotwoApiBase,
    migrateZerotwoHostedUrl,
};
