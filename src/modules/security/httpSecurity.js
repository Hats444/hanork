'use strict';

/**
 * Headers HTTP de segurança + rate limit dedicado à vitrine pública (/loja/*).
 */
const vitrineRateMap = new Map();

function clientIp(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
}

function applySecurityHeaders(req, res, next) {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Frame-Options', 'DENY');
    res.set('X-XSS-Protection', '1; mode=block');
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    res.set('Cross-Origin-Opener-Policy', 'same-origin');
    res.set('Cross-Origin-Resource-Policy', 'same-site');

    if (process.env.NODE_ENV === 'production') {
        const proto = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : '');
        if (proto === 'https' || req.secure) {
            res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
        }
    }

    const path = (req.path || '').toLowerCase();
    if (path.startsWith('/admin')) {
        res.set(
            'Content-Security-Policy',
            "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'"
        );
    } else if (path.startsWith('/loja/')) {
        res.set(
            'Content-Security-Policy',
            "default-src 'self'; script-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; frame-ancestors 'none'; base-uri 'self'"
        );
    }

    next();
}

/** 60 req/min por IP nas rotas /loja (anti-scraping). */
function vitrineRateLimit(req, res, next) {
    if (!req.path?.startsWith('/loja/')) return next();
    const ip = clientIp(req);
    const now = Date.now();
    const windowMs = 60000;
    const max = Number(process.env.VITRINE_RATE_LIMIT_PER_MIN) || 60;
    let entry = vitrineRateMap.get(ip);
    if (!entry || now - entry.ts > windowMs) {
        entry = { count: 0, ts: now };
    }
    entry.count++;
    vitrineRateMap.set(ip, entry);
    if (entry.count > max) {
        res.set('Retry-After', String(Math.ceil((entry.ts + windowMs - now) / 1000)));
        return res.status(429).send('Muitas requisições. Tente novamente em instantes.');
    }
    next();
}

function cleanupVitrineRateMap() {
    const now = Date.now();
    for (const [ip, entry] of vitrineRateMap) {
        if (now - entry.ts > 120000) vitrineRateMap.delete(ip);
    }
}

const mpGoRateMap = new Map();

/** Rate limit GET /mp/go/:prefId — anti-enumeração de preferências MP. */
function mpGoRateLimit(req, res, next) {
    const ip = clientIp(req);
    const now = Date.now();
    const windowMs = 60000;
    const max = Number(process.env.MP_GO_RATE_LIMIT_PER_MIN) || 40;
    let entry = mpGoRateMap.get(ip);
    if (!entry || now - entry.ts > windowMs) {
        entry = { count: 0, ts: now };
    }
    entry.count++;
    mpGoRateMap.set(ip, entry);
    if (entry.count > max) {
        res.set('Retry-After', String(Math.ceil((entry.ts + windowMs - now) / 1000)));
        return res.status(429).send('Muitas requisições. Tente novamente em instantes.');
    }
    next();
}

function cleanupMpGoRateMap() {
    const now = Date.now();
    for (const [ip, entry] of mpGoRateMap) {
        if (now - entry.ts > 120000) mpGoRateMap.delete(ip);
    }
}

setInterval(cleanupVitrineRateMap, 120000).unref?.();
setInterval(cleanupMpGoRateMap, 120000).unref?.();

module.exports = {
    applySecurityHeaders,
    vitrineRateLimit,
    mpGoRateLimit,
    clientIp,
    vitrineRateMap,
    mpGoRateMap,
};
