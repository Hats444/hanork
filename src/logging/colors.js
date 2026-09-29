'use strict';

const palette = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    white: '\x1b[97m',
    gray: '\x1b[90m',
    red: '\x1b[91m',
    yellow: '\x1b[93m',
    green: '\x1b[92m',
    cyan: '\x1b[96m',
    blue: '\x1b[94m',
    magenta: '\x1b[95m',
    orange: '\x1b[33m',
    bgRed: '\x1b[41m',
    bgGreen: '\x1b[42m',
    bgYellow: '\x1b[43m',
    bgBlue: '\x1b[44m',
    bgCyan: '\x1b[46m',
    bgMagenta: '\x1b[45m',
    bgGray: '\x1b[100m',
};

const LEVEL_STYLE = {
    DEBUG: { badge: 'DBG', fg: palette.gray, bg: palette.bgGray },
    INFO: { badge: 'INF', fg: palette.white, bg: palette.bgBlue },
    SUCCESS: { badge: ' OK', fg: palette.green, bg: palette.bgGreen },
    WARN: { badge: 'WRN', fg: palette.yellow, bg: palette.bgYellow },
    ERROR: { badge: 'ERR', fg: palette.red, bg: palette.bgRed },
    FATAL: { badge: 'FTL', fg: palette.red, bg: palette.bgRed },
    SECURITY: { badge: 'SEC', fg: palette.magenta, bg: palette.bgMagenta },
    API: { badge: 'API', fg: palette.cyan, bg: palette.bgCyan },
    DATABASE: { badge: ' DB', fg: palette.blue, bg: palette.bgBlue },
    CACHE: { badge: 'CCH', fg: palette.cyan, bg: palette.bgGray },
    SOCKET: { badge: 'SOC', fg: palette.magenta, bg: palette.bgMagenta },
    TELEGRAM: { badge: ' TG', fg: palette.cyan, bg: palette.bgCyan },
    PERFORMANCE: { badge: 'PRF', fg: palette.green, bg: palette.bgGray },
};

function wrap(enabled, code, text) {
    if (!enabled) return text;
    return `${code}${text}${palette.reset}`;
}

module.exports = { palette, LEVEL_STYLE, wrap };
