'use strict';

const LEVEL_RANK = {
    DEBUG: 0,
    INFO: 1,
    SUCCESS: 1,
    WARN: 2,
    ERROR: 3,
    FATAL: 4,
    SECURITY: 2,
    API: 1,
    DATABASE: 1,
    CACHE: 1,
    SOCKET: 1,
    TELEGRAM: 1,
    PERFORMANCE: 1,
};

const CATEGORY_ALIASES = {
    SYSTEM: 'SYSTEM',
    LOADER: 'LOADER',
    TELEGRAM: 'TELEGRAM',
    API: 'API',
    DATABASE: 'DATABASE',
    DB: 'DATABASE',
    CACHE: 'CACHE',
    SECURITY: 'SECURITY',
    SOCKET: 'SOCKET',
    PERFORMANCE: 'PERFORMANCE',
    PERF: 'PERFORMANCE',
    PAYMENT: 'API',
    PAY: 'API',
    WEBHOOK: 'API',
    ORDER: 'DATABASE',
    CART: 'DATABASE',
    USER: 'TELEGRAM',
    ADMIN: 'TELEGRAM',
    BOT: 'TELEGRAM',
    EXPRESS: 'API',
    QUEUE: 'SOCKET',
    CRON: 'SYSTEM',
    ENV: 'SYSTEM',
    MENU: 'SYSTEM',
    GROUP: 'TELEGRAM',
    AFF: 'DATABASE',
    CHECKOUT: 'API',
    CLEANUP: 'SYSTEM',
    CALLBACK: 'LOADER',
};

function detectEnvironment() {
    const nodeEnv = process.env.NODE_ENV || 'development';
    if (nodeEnv === 'production') return 'PROD';
    if (nodeEnv === 'test') return 'TEST';
    return 'DEV';
}

function parseList(raw) {
    return (raw || '')
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
}

/** Cores no console ou no ~/.hanork/terminal.log (tail -F). */
function isColorsEnabled(options = {}) {
    const { forTerminalLog = false } = options;
    if (process.env.NO_COLOR === '1') return false;
    if (process.env.FORCE_COLOR === '0' || process.env.FORCE_COLOR === 'false') return false;
    const fc = String(process.env.FORCE_COLOR || '');
    if (fc === '1' || fc === '2' || fc === '3' || fc === 'true') return true;
    if (process.env.HANORK_LOG_COLORS === '1' || process.env.HANORK_LOG_COLORS === 'true') {
        return true;
    }
    if (forTerminalLog) {
        if (process.env.HANORK_TERMINAL_LOG_PLAIN === '1') return false;
        return true;
    }
    return process.stdout.isTTY !== false;
}

function getLogConfig() {
    const environment = detectEnvironment();
    const verbose =
        process.env.LOG_VERBOSE === '1' ||
        process.env.LOG_VERBOSE === 'true' ||
        environment === 'DEV';

    const defaultLevel = environment === 'PROD' ? 'INFO' : 'DEBUG';
    const minLevel = (process.env.LOG_LEVEL || defaultLevel).toUpperCase();
    const minRank = LEVEL_RANK[minLevel] ?? LEVEL_RANK.INFO;

    return {
        environment,
        verbose,
        minLevel,
        minRank,
        hideCategories: new Set(parseList(process.env.LOG_HIDE)),
        onlyCategories: new Set(parseList(process.env.LOG_CATEGORIES)),
        logFile: process.env.LOG_FILE || '',
        colorsEnabled: isColorsEnabled(),
        showContext: process.env.LOG_CONTEXT !== '0',
    };
}

function getMirrorLogConfig(base) {
    const cfg = base || getLogConfig();
    return { ...cfg, colorsEnabled: isColorsEnabled({ forTerminalLog: true }) };
}

function normalizeCategory(raw) {
    if (!raw) return 'SYSTEM';
    const key = String(raw).replace(/^\[|\]$/g, '').toUpperCase();
    return CATEGORY_ALIASES[key] || key;
}

function parseBracketModule(message) {
    if (typeof message !== 'string') return { module: null, text: message };
    const m = message.match(/^\[([^\]]+)\]\s*(.*)$/s);
    if (!m) return { module: null, text: message };
    return { module: m[1], text: m[2] || '' };
}

module.exports = {
    LEVEL_RANK,
    CATEGORY_ALIASES,
    getLogConfig,
    getMirrorLogConfig,
    isColorsEnabled,
    normalizeCategory,
    parseBracketModule,
    detectEnvironment,
};
