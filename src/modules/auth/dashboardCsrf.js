'use strict';

const crypto = require('crypto');

const CSRF_COOKIE = 'dashboard_csrf';
const CSRF_HEADER = 'x-csrf-token';

function isCsrfEnforced() {
    return process.env.DASHBOARD_CSRF !== '0';
}

function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

function csrfCookieFlags() {
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    return `SameSite=Strict${secure}`;
}

function setCsrfCookie(res, token) {
    res.append(
        'Set-Cookie',
        `${CSRF_COOKIE}=${encodeURIComponent(token)}; ${csrfCookieFlags()}; Max-Age=28800; Path=/`
    );
}

function clearCsrfCookie(res) {
    res.append('Set-Cookie', `${CSRF_COOKIE}=; ${csrfCookieFlags()}; Max-Age=0; Path=/`);
}

function validateCsrf(req) {
    if (!isCsrfEnforced()) return { ok: true };
    const header = String(req.headers[CSRF_HEADER] || '').trim();
    const cookie = String(req.cookies?.[CSRF_COOKIE] || '').trim();
    if (!header || !cookie) {
        return { ok: false, status: 403, error: 'CSRF token ausente' };
    }
    const a = Buffer.from(header);
    const b = Buffer.from(cookie);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return { ok: false, status: 403, error: 'CSRF token inválido' };
    }
    return { ok: true };
}

function ensureCsrfCookie(req, res, next) {
    if (!isCsrfEnforced()) return next();
    if (!req.cookies?.[CSRF_COOKIE]) {
        setCsrfCookie(res, generateToken());
    }
    next();
}

function requireCsrfForMutations(req, res, next) {
    const method = req.method.toUpperCase();
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return next();
    if (!isCsrfEnforced()) return next();
    const check = validateCsrf(req);
    if (!check.ok) {
        return res.status(check.status).json({ error: check.error });
    }
    next();
}

module.exports = {
    CSRF_COOKIE,
    CSRF_HEADER,
    isCsrfEnforced,
    generateToken,
    setCsrfCookie,
    clearCsrfCookie,
    validateCsrf,
    ensureCsrfCookie,
    requireCsrfForMutations,
};
