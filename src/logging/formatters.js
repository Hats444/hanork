'use strict';

const { palette, LEVEL_STYLE, wrap } = require('./colors');

function timestamp() {
    return new Date().toLocaleTimeString('pt-BR', { hour12: false });
}

function formatContext(ctx, colors) {
    if (ctx == null || ctx === '') return '';
    if (typeof ctx === 'string') return ctx;
    try {
        const compact = JSON.stringify(ctx);
        if (compact.length > 280) return compact.slice(0, 277) + '…';
        return compact;
    } catch {
        return String(ctx);
    }
}

function formatStack(err, colors) {
    if (!err) return '';
    const stack = err.stack || String(err);
    const lines = stack.split('\n').slice(0, 12);
    return lines
        .map((line, i) => {
            const prefix = i === 0 ? '  ▼ ' : '    ';
            return wrap(colors, palette.dim + palette.gray, `${prefix}${line}`);
        })
        .join('\n');
}

/** Linha idêntica ao console, sem cores ANSI (para Telegram / arquivo). */
function formatPlainLine({ level, category, module, message, context }, config) {
    const style = LEVEL_STYLE[level] || LEVEL_STYLE.INFO;
    const ts = `[${timestamp()}]`;
    const cat = `[${category}]`;
    const mod = module ? `[${module}]` : '';
    const lvl = ` ${style.badge} `;
    const arrow = ' → ';
    const msg = String(message);
    let line = `${ts} ${cat}${mod ? ` ${mod}` : ''}${lvl}${arrow}${msg}`;
    if (config.showContext && context) {
        const ctx = formatContext(context, false);
        if (ctx) line += `  │ ${ctx}`;
    }
    return line;
}

function formatLine({ level, category, module, message, context }, config) {
    const style = LEVEL_STYLE[level] || LEVEL_STYLE.INFO;
    const c = config.colorsEnabled;
    const ts = wrap(c, palette.dim + palette.gray, `[${timestamp()}]`);
    const cat = wrap(c, palette.cyan, `[${category}]`);
    const mod = module
        ? wrap(c, palette.dim + palette.magenta, `[${module}]`)
        : '';
    const lvl = wrap(
        c,
        style.bg + palette.bold + palette.white,
        ` ${style.badge} `
    );
    const arrow = wrap(c, palette.dim + palette.gray, ' → ');
    const msg = wrap(c, style.fg, String(message));
    let line = `${ts} ${cat}${mod ? ` ${mod}` : ''} ${lvl}${arrow}${msg}`;

    if (config.showContext && context) {
        const ctx = formatContext(context, c);
        if (ctx) line += wrap(c, palette.dim + palette.gray, `  │ ${ctx}`);
    }
    return line;
}

function separator(width = 62, char = '─', colors = true) {
    return wrap(colors, palette.dim + palette.gray, char.repeat(width));
}

function separatorHeavy(width = 62, colors = true) {
    return wrap(colors, palette.dim + palette.magenta, '═'.repeat(width));
}

module.exports = {
    timestamp,
    formatPlainLine,
    formatLine,
    formatContext,
    formatStack,
    separator,
    separatorHeavy,
};
