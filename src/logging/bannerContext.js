'use strict';

const os = require('os');
const path = require('path');
const { detectEnvironment } = require('./config');

function envBool(name, fallback = false) {
    const v = process.env[name];
    if (v == null || v === '') return fallback;
    return ['1', 'true', 'yes', 'on'].includes(String(v).trim().toLowerCase);
}

function shortPath(p) {
    const home = os.homedir();
    let s = String(p || '—');
    if (s.startsWith(home)) s = `~${s.slice(home.length)}`;
    if (s.length > 44) s = `${s.slice(0, 22)}…${s.slice(-18)}`;
    return s;
}

function parseAdminCount() {
    return (process.env.ID_DONO || '')
        .split(',')
        .map((id) => parseInt(id.trim(), 10))
        .filter(Boolean)
        .length;
}

function resolveBotUsername() {
    const raw =
        process.env.BOT_USERNAME ||
        process.env.HANORK_BOT_USERNAME ||
        process.env.TELEGRAM_BOT_USERNAME ||
        '';
    return String(raw).replace(/^@/, '').trim();
}

function resolveRedisLabel() {
    const url = process.env.REDIS_URL || '';
    if (!url) return '—';
    try {
        const u = new URL(url);
        const host = u.hostname || 'localhost';
        const port = u.port ? `:${u.port}` : '';
        return `${host}${port}`;
    } catch {
        return 'configurado';
    }
}

function resolveSiteLabel() {
    const raw = process.env.SITE_HANORK || '';
    if (!raw) return null;
    try {
        return new URL(raw).hostname.replace(/^www\./, '');
    } catch {
        return raw.replace(/^https?:\/\//, '').split('/')[0];
    }
}

function isWslPath(p) {
    return /^\/mnt\//.test(String(p || ''));
}

/**
 * Dados disponíveis antes do boot completo (env + OS).
 */
function collectPreBootBannerInfo() {
    const cwd = process.cwd();
    const botUser = resolveBotUsername();
    const dbPath =
        process.env.HANORK_DB_PATH ||
        path.join(os.homedir(), '.hanork', 'hanork.db');
    const mpOn = (process.env.TOKEN_MP || '').length > 10;
    const zeroOn = envBool('ZERO_DIVU_ENABLED', false);
    const platform = `${os.platform()} ${os.arch()}`;
    const wsl = isWslPath(cwd) || isWslPath(dbPath);

    return {
        botUser,
        botLink: botUser ? `t.me/${botUser}` : null,
        environment: detectEnvironment(),
        httpPort: process.env.PORT || '3000',
        mercadoPago: mpOn ? 'ON' : 'OFF',
        zeroDivu: zeroOn ? 'ON' : 'OFF',
        redis: resolveRedisLabel(),
        adminCount: parseAdminCount(),
        site: resolveSiteLabel(),
        dbPath: shortPath(dbPath),
        repoPath: shortPath(cwd),
        platform: wsl ? `${platform} · WSL` : platform,
        webhook: process.env.WEBHOOK_URL ? 'ON' : 'OFF',
        notifyBot: (process.env.TOKEN_TELEGRAM_NOTIFY || '').length > 10 ? 'ON' : 'OFF',
        startedAt: new Date().toLocaleString('pt-BR', { hour12: false }),
    };
}

module.exports = {
    collectPreBootBannerInfo,
    shortPath,
    resolveBotUsername,
};
