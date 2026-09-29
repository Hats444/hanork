'use strict';

function getZerotwoApiKey() {
    const raw = process.env.API_KEY_ZEROTWO;
    if (typeof raw !== 'string') return '';
    return raw.trim();
}

function isZerotwoApiKeyStrictRequired() {
    const flag = process.env.ZEROTWO_API_KEY_REQUIRED;
    if (flag === '1' || flag === 'true') return true;
    if (flag === '0' || flag === 'false') return false;
    return process.env.NODE_ENV === 'production';
}

function assertZerotwoApiKeyAtBoot(logger) {
    const key = getZerotwoApiKey();
    const strict = isZerotwoApiKeyStrictRequired();
    const warn = (msg) => (logger?.warn ? logger.warn(msg) : console.warn(msg));
    const error = (msg) => (logger?.error ? logger.error(msg) : console.error(msg));

    if (!key) {
        const msg =
            '[ENV] API_KEY_ZEROTWO ausente — configure no .env (/play, IA, catálogo WA, etc.)';
        if (strict) {
            error(msg);
            process.exit(1);
        }
        warn(msg + ' — recursos Zero Two desativados até configurar');
        return { ok: false, reason: 'missing' };
    }

    return { ok: true, key };
}

module.exports = {
    getZerotwoApiKey,
    isZerotwoApiKeyStrictRequired,
    assertZerotwoApiKeyAtBoot,
};
