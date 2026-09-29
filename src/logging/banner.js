'use strict';

const { palette, wrap } = require('./colors');
const { separatorHeavy } = require('./formatters');
const { getLogConfig, getMirrorLogConfig, isColorsEnabled } = require('./config');
const path = require('path');
const {
    getMemory,
    getCpuLoad,
    getBootIso,
    getHostSummary,
} = require('./systemMetrics');
const { collectPreBootBannerInfo } = require('./bannerContext');
const { safeStreamWrite } = require('./safeStreamWrite');

const LOGO = [
    '  ██╗  ██╗ █████╗ ███╗   ██╗ ██████╗ ██████╗ ██╗  ██╗',
    '  ██║  ██║██╔══██╗████╗  ██║██╔═══██╗██╔══██╗██║ ██╔╝',
    '  ███████║███████║██╔██╗ ██║██║   ██║██████╔╝█████╔╝ ',
    '  ██╔══██║██╔══██║██║╚██╗██║██║   ██║██╔══██╗██╔═██╗ ',
    '  ██║  ██║██║  ██║██║ ╚████║╚██████╔╝██║  ██║██║  ██╗',
    '  ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝ ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝',
];

function kv(label, value, colors, valueStyle) {
    const l = wrap(colors, palette.dim + palette.gray, `  ◆ ${label.padEnd(14)}`);
    const v = wrap(colors, valueStyle || palette.white, value);
    return `${l} ${v}`;
}

function kvAccent(label, value, colors) {
    return kv(label, value, colors, palette.bold + palette.cyan);
}

function kvStatus(label, value, colors, on) {
    const style = on ? palette.bold + palette.green : palette.dim + palette.gray;
    return kv(label, value, colors, style);
}

function writeBannerBlock(block, { mirrorOnly = false } = {}) {
    const fileOnly =
        mirrorOnly ||
        (process.env.HANORK_LOG_BG === '1' && Boolean(process.env.HANORK_TERMINAL_LOG));
    if (!fileOnly) safeStreamWrite(process.stdout, block);
    try {
        const { appendTerminalLog } = require('./terminalMirror');
        appendTerminalLog(block);
    } catch { /* ignore */ }
}

/** Banner Hanork — início do boot ou fim (stats completos). */
function renderBootBanner(stats, config, opts = {}) {
    const loading = Boolean(opts.loading);
    const c = config.colorsEnabled;
    const info = collectPreBootBannerInfo();
    const host = getHostSummary();
    const mem = getMemory();
    const cpu = getCpuLoad();
    const user = process.env.USER || process.env.USERNAME || 'user';
    const botUser = stats.botUsername || info.botUser;

    const lines = [];
    lines.push('');
    lines.push(separatorHeavy(58, c));
    for (const row of LOGO) {
        lines.push(wrap(c, palette.bold + palette.magenta, row));
    }
    lines.push(
        wrap(
            c,
            palette.dim + palette.cyan,
            '  ── observability console · sales automation ──'
        )
    );
    lines.push(separatorHeavy(58, c));

    lines.push(kv('Versão', stats.version || '—', c));
    lines.push(kv('Ambiente', config.environment, c));
    lines.push(kv('Início', getBootIso(), c));
    lines.push(kv('Runtime', host.node, c));
    lines.push(kv('Host', info.platform || host.platform, c));
    lines.push(kv('Sessão', `${user}@${host.hostname}`, c));
    lines.push(kv('RAM (RSS)', mem.rss, c));
    lines.push(kv('Heap', `${mem.heapUsed} / ${mem.heapTotal}`, c));
    lines.push(kv('CPU load', `${cpu.load1} · ${cpu.cores} cores (~${cpu.percentApprox}%)`, c));
    lines.push(kv('PID', String(process.pid), c));
    lines.push(kv('Banco SQLite', info.dbPath, c));

    if (stats.pingMs != null) lines.push(kv('Telegram ping', `${stats.pingMs} ms`, c));
    if (stats.port) lines.push(kv('HTTP', `:${stats.port}`, c));
    if (botUser) {
        lines.push(kvAccent('Bot', `@${botUser}`, c));
        lines.push(kv('Link Telegram', `t.me/${botUser}`, c));
    }
    lines.push(kvStatus('Mercado Pago', info.mercadoPago, c, info.mercadoPago === 'ON'));
    lines.push(kvStatus('Webhook MP', info.webhook, c, info.webhook === 'ON'));
    lines.push(kvStatus('Bot notify', info.notifyBot, c, info.notifyBot === 'ON'));
    lines.push(kv('Redis', info.redis, c));
    if (info.site) lines.push(kv('Site', info.site, c));

    lines.push(separatorHeavy(58, c));
    if (loading) {
        lines.push(wrap(c, palette.dim + palette.gray, '  ▸ carregando módulos…'));
    } else {
        lines.push(wrap(c, palette.dim + palette.gray, '  ▸ módulos carregados'));
        lines.push(kv('Callbacks', String(stats.callbacks ?? '—'), c));
        lines.push(kv('Comandos menu', String(stats.commands ?? '—'), c));
        lines.push(kv('Admins', String(stats.admins ?? '—'), c));
        lines.push(kv('Produtos', String(stats.products ?? '—'), c));
        lines.push(kv('Usuários', String(stats.users ?? '—'), c));
        if (stats.plugins) lines.push(kv('Plugins', String(stats.plugins), c));
        if (stats.zeroDivu) lines.push(kv('Zero Divu', String(stats.zeroDivu), c));
        if (stats.promoSlots != null) lines.push(kv('Slots promo', String(stats.promoSlots), c));
    }
    lines.push(separatorHeavy(58, c));
    lines.push('');
    return lines.join('\n');
}

/** Logo + stats iniciais — logo após adquirir lock. */
function printStartupBanner() {
    let version = '—';
    try {
        version = `v${require(path.join(__dirname, '../../package.json')).version || '—'}`;
    } catch { /* ignore */ }

    const info = collectPreBootBannerInfo();
    const config = getLogConfig();
    const stats = {
        version,
        port: info.httpPort,
        botUsername: info.botUser || undefined,
    };

    writeBannerBlock(renderBootBanner(stats, getMirrorLogConfig(config), { loading: true }), {
        mirrorOnly: true,
    });

    if (process.stdout.isTTY && process.env.HANORK_LOG_BG !== '1') {
        safeStreamWrite(
            process.stdout,
            renderBootBanner(stats, { ...config, colorsEnabled: isColorsEnabled() }, { loading: true })
        );
    }
}

function printConsoleBanner() {
    printStartupBanner();
}

module.exports = {
    renderBootBanner,
    printStartupBanner,
    printConsoleBanner,
    LOGO,
};
