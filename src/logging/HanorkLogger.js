'use strict';

const { palette, wrap } = require('./colors');
const { formatLine, formatPlainLine, formatStack, separator } = require('./formatters');
const { getLogConfig, getMirrorLogConfig, normalizeCategory, parseBracketModule, LEVEL_RANK } = require('./config');
const { renderBootBanner } = require('./banner');
const { getUptime } = require('./systemMetrics');
const FileTransport = require('./fileTransport');
const { appendTerminalLog } = require('./terminalMirror');
const { createBenchmark } = require('./benchmark');
const correlationContext = require('../infrastructure/CorrelationContext');
const { safeStreamWrite } = require('./safeStreamWrite');

function terminalLogFileOnly() {
    return process.env.HANORK_LOG_BG === '1' && Boolean(process.env.HANORK_TERMINAL_LOG);
}

class HanorkLogger {
    constructor() {
        this._config = getLogConfig();
        this._file = new FileTransport(this._config.logFile);
        this._childCache = new Map();
        this._adminActivitySink = null;
        this._consoleMirrorSink = null;
        const { bench, benchSync } = createBenchmark(this);
        this.bench = bench;
        this.benchSync = benchSync;
    }

    /** Encaminha eventos de domínio (carrinho, venda, ticket…) para o bot de aviso admin */
    setAdminActivitySink(fn) {
        this._adminActivitySink = typeof fn === 'function' ? fn : null;
    }

    /** Espelha cada linha do console no PV admin (texto igual ao terminal). */
    setConsoleMirrorSink(fn) {
        this._consoleMirrorSink = typeof fn === 'function' ? fn : null;
    }

    _adminNotify(line, userId) {
        try {
            this._adminActivitySink?.(line, userId);
        } catch {
            /* ignore */
        }
    }

    refreshConfig() {
        this._config = getLogConfig();
        return this._config;
    }

    child(defaults = {}) {
        const key = JSON.stringify(defaults);
        if (this._childCache.has(key)) return this._childCache.get(key);
        const parent = this;
        const child = {
            log: (level, message, ctx) =>
                parent.log(level, message, {
                    category: defaults.category,
                    module: defaults.module,
                    ...ctx,
                }),
            debug: (m, c) => parent.debug(m, { ...defaults, ...c }),
            info: (m, c) => parent.info(m, { ...defaults, ...c }),
            warn: (m, c) => parent.warn(m, { ...defaults, ...c }),
            error: (m, c) => parent.error(m, { ...defaults, ...c }),
            success: (m, c) => parent.success(m, { ...defaults, ...c }),
        };
        this._childCache.set(key, child);
        return child;
    }

    _shouldLog(level, category) {
        const cfg = this._config;
        const rank = LEVEL_RANK[level] ?? LEVEL_RANK.INFO;
        if (rank < cfg.minRank) return false;
        if (cfg.hideCategories.has(category)) return false;
        if (cfg.onlyCategories.size > 0 && !cfg.onlyCategories.has(category)) return false;
        return true;
    }

    _emit(level, category, module, message, context) {
        if (!this._shouldLog(level, category)) return;

        let ctx = context;
        const correlationId = correlationContext.getId();
        if (correlationId) {
            if (ctx && typeof ctx === 'object' && !Array.isArray(ctx)) {
                if (!ctx.correlationId) ctx = { ...ctx, correlationId };
            } else if (ctx == null) {
                ctx = { correlationId };
            }
        }

        const line = formatLine(
            { level, category, module, message, context: ctx },
            this._config
        );
        const mirrorLine = formatLine(
            { level, category, module, message, context: ctx },
            getMirrorLogConfig(this._config)
        );
        const out = level === 'ERROR' || level === 'FATAL' ? process.stderr : process.stdout;
        const fileOnly = terminalLogFileOnly();

        if (!fileOnly) {
            safeStreamWrite(out, line + '\n');
        }

        if (process.env.HANORK_TERMINAL_LOG) {
            appendTerminalLog(mirrorLine);
        }

        if (ctx?.err || ctx?.error instanceof Error) {
            const err = ctx.err || ctx.error;
            const stack = formatStack(err, this._config.colorsEnabled);
            if (!fileOnly) {
                safeStreamWrite(out, stack + '\n');
            }
            if (process.env.HANORK_TERMINAL_LOG) {
                appendTerminalLog(formatStack(err, getMirrorLogConfig(this._config).colorsEnabled));
            }
        }

        this._file.write({
            level,
            category,
            module,
            message,
            context: typeof ctx === 'object' ? ctx : { extra: ctx },
        });

        if (this._consoleMirrorSink) {
            try {
                const plain = formatPlainLine(
                    { level, category, module, message, context: ctx },
                    this._config
                );
                this._consoleMirrorSink(plain, { level, category, module });
            } catch {
                /* ignore */
            }
        }
    }

    /**
     * API estruturada principal
     * log('INFO', 'Plugin carregado', { category: 'LOADER', module: 'auth' })
     */
    log(level, message, opts = {}) {
        const lvl = String(level || 'INFO').toUpperCase();
        let { category, module, context } = opts;
        let text = message;

        if (typeof message === 'object' && message !== null) {
            context = message;
            text = opts.message || '';
        }

        const parsed = parseBracketModule(text);
        if (parsed.module && !module) module = parsed.module;
        text = parsed.text || text;

        category = normalizeCategory(category || module || parsed.module);
        if (!module && parsed.module) module = parsed.module;

        const ctx =
            context ??
            (typeof opts === 'object' && !opts.category && !opts.module ? opts : undefined);

        this._emit(lvl, category, module, text, ctx);
    }

    debug(message, extra) {
        this._legacy('DEBUG', message, extra);
    }
    info(message, extra) {
        this._legacy('INFO', message, extra);
    }
    warn(message, extra) {
        this._legacy('WARN', message, extra);
    }
    error(message, extra) {
        this._legacy('ERROR', message, extra);
    }
    fatal(message, extra) {
        this._legacy('FATAL', message, extra);
    }
    success(message, extra) {
        this._legacy('SUCCESS', message, extra);
    }

    security(message, extra) {
        this._legacy('SECURITY', message, extra, 'SECURITY');
    }
    api(message, extra) {
        this._legacy('API', message, extra, 'API');
    }
    database(message, extra) {
        this._legacy('DATABASE', message, extra, 'DATABASE');
    }
    cache(message, extra) {
        this._legacy('CACHE', message, extra, 'CACHE');
    }
    telegram(message, extra) {
        this._legacy('TELEGRAM', message, extra, 'TELEGRAM');
    }
    performance(label, ms, extra = {}) {
        const duration =
            typeof ms === 'number' ? `${ms.toFixed(1)}ms` : String(ms);
        this._emit('PERFORMANCE', 'PERFORMANCE', null, `${label} · ${duration}`, extra);
    }

    _legacy(level, message, extra, forceCategory) {
        const parsed = parseBracketModule(message);
        let category = forceCategory || 'SYSTEM';
        let module = null;
        let text = parsed.text;

        if (parsed.module) {
            module = parsed.module;
            if (!forceCategory) category = normalizeCategory(parsed.module);
            if (module === category) module = null;
        }

        if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
            if (extra.category) category = normalizeCategory(extra.category);
            if (extra.module) module = extra.module;
        }

        const context =
            extra == null || extra === ''
                ? undefined
                : typeof extra === 'string'
                    ? { detail: extra }
                    : extra;

        this._emit(level, category, module, text, context);
    }

    sep(heavy) {
        const { separatorHeavy } = require('./formatters');
        safeStreamWrite(process.stdout, (heavy === '═' ? separatorHeavy() : separator()) + '\n');
    }

    bootstrap(stats = {}) {
        const { noBanner, ...rest } = stats || {};
        if (!noBanner) {
            const bannerOut = renderBootBanner(rest, this._config);
            const mirrorBanner = renderBootBanner(rest, getMirrorLogConfig(this._config));
            if (!terminalLogFileOnly()) {
                safeStreamWrite(process.stdout, bannerOut);
                if (process.stdout.isTTY) safeStreamWrite(process.stdout, '\n');
            }
            if (process.env.HANORK_TERMINAL_LOG) {
                appendTerminalLog(mirrorBanner);
            }
        }
        this.success('Sistema operacional — pronto para tráfego', {
            category: 'SYSTEM',
            module: 'BOOT',
            uptime: getUptime(),
            ...rest,
        });
    }

    /** @deprecated use bootstrap() — mantém assinatura legada */
    banner(version, admins, products, users) {
        this.bootstrap({
            version,
            admins,
            products,
            users,
        });
    }

    // ── Domínio (UX Telegram) ───────────────────────────────────────────────

    _userLine(userId, username) {
        const name = username ? `@${username}` : `#${userId}`;
        const c = this._config.colorsEnabled;
        return `${wrap(c, palette.bold + palette.cyan, name)}${wrap(c, palette.dim + palette.gray, `(${userId})`)}`;
    }

    msg(userId, username, text) {
        if (!this._shouldLog('INFO', 'TELEGRAM')) return;
        const preview = text.length > 60 ? text.slice(0, 60) + '…' : text;
        this._emit('INFO', 'TELEGRAM', 'MSG', `${this._userLine(userId, username)} "${preview}"`);
    }

    cmd(userId, username, command) {
        if (!this._shouldLog('INFO', 'TELEGRAM')) return;
        this._emit('INFO', 'TELEGRAM', 'CMD', `${this._userLine(userId, username)} ${command}`);
    }

    action(userId, username, data) {
        const skip = ['home', 'cat', 'cart'];
        if (skip.includes(data) && !this._config.verbose) return;
        if (!this._shouldLog('DEBUG', 'TELEGRAM')) return;
        const label = data.length > 30 ? data.slice(0, 30) + '…' : data;
        this._emit('DEBUG', 'TELEGRAM', 'BTN', `${this._userLine(userId, username)} [${label}]`);
    }

    newUser(userId, username) {
        this.sep();
        this._emit('SUCCESS', 'TELEGRAM', 'USER', `Novo usuário ${this._userLine(userId, username)}`);
        this.sep();
        this._adminNotify('entrou na loja pela primeira vez (/start)', userId);
    }

    cart(userId, username, productName, qty = 1) {
        this._emit('INFO', 'TELEGRAM', 'CART', `${this._userLine(userId, username)} ${qty}x ${productName}`);
        this._adminNotify(`adicionou ${qty}x «${productName}» ao carrinho`, userId);
    }

    order(userId, username, orderId, total) {
        const totalStr = Number.isFinite(Number(total)) ? Number(total).toFixed(2) : '0.00';
        this._emit('INFO', 'DATABASE', 'ORDER', `${this._userLine(userId, username)} #${String(orderId).slice(-8)} R$ ${totalStr}`);
        this._adminNotify(`criou pedido #${String(orderId).slice(-8)} · R$ ${totalStr}`, userId);
    }

    sale(userId, orderId, total, method = '') {
        this.sep('═');
        const meth = method ? ` [${method.toUpperCase()}]` : '';
        this._emit(
            'SUCCESS',
            'API',
            'VENDA',
            `APROVADA user=${userId} #${String(orderId).slice(-8)} R$ ${Number(total).toFixed(2)}${meth}`
        );
        this.sep('═');
        const methTxt = method ? ` via ${String(method).toUpperCase()}` : '';
        this._adminNotify(
            `pagamento aprovado #${String(orderId).slice(-8)} · R$ ${Number(total).toFixed(2)}${methTxt}`,
            userId
        );
    }

    delivered(userId, orderId, productName) {
        this._emit('SUCCESS', 'DATABASE', 'ENTREGA', `user=${userId} #${String(orderId).slice(-8)} "${productName}"`);
        this._adminNotify(`recebeu entrega #${String(orderId).slice(-8)} · «${productName}»`, userId);
    }

    webhook(paymentId, status) {
        this._emit('INFO', 'API', 'WEBHOOK', `payment=${paymentId} status=${status}`);
    }

    coupon(userId, code, discount) {
        this._emit('INFO', 'DATABASE', 'CUPOM', `user=${userId} code=${code} -R$ ${Number(discount).toFixed(2)}`);
        this._adminNotify(`usou cupom ${code} (−R$ ${Number(discount).toFixed(2)})`, userId);
    }

    ticket(ticketId, userId, username) {
        this._emit('INFO', 'TELEGRAM', 'TICKET', `#${ticketId} ${this._userLine(userId, username)}`);
        this._adminNotify(`abriu ticket de suporte #${ticketId}`, userId);
    }

    spam(userId, reason) {
        let detail;
        if (reason && typeof reason === 'object') {
            detail = [
                reason.event,
                reason.strike != null ? `#${reason.strike}` : null,
                reason.durationSec != null ? `${reason.durationSec}s` : null,
                reason.violation,
                reason.detail,
            ]
                .filter(Boolean)
                .join(' · ');
        } else {
            detail = String(reason ?? '');
        }
        this._emit('SECURITY', 'SECURITY', 'SPAM', `user=${userId} ${detail}`);
        this._adminNotify(`alerta anti-spam: ${detail || 'violação'}`, userId);
    }

    admin(adminId, action, extra = '') {
        this._emit('INFO', 'TELEGRAM', 'ADMIN', `${adminId} ${action}`, extra ? { detail: extra } : undefined);
    }

    flashSale(productName, price, hours) {
        this._emit('INFO', 'SYSTEM', 'FLASH', `${productName} R$ ${price} · ${hours}h`);
    }

    payment(msg, extra) {
        this._legacy('WARN', msg, extra, 'API');
    }

    retry(operation, attempt, maxAttempts, delayMs) {
        this._emit('WARN', 'SYSTEM', 'RETRY', `${operation} ${attempt}/${maxAttempts} em ${delayMs}ms`);
    }

    webhookRejected(reason, ip, signature = null) {
        this._emit('SECURITY', 'SECURITY', 'WEBHOOK', `rejeitado ${reason} ip=${ip}`, {
            signature: signature ? signature.slice(0, 16) : null,
        });
    }

    deliveryFailed(userId, orderId, productName, error) {
        this._emit('ERROR', 'DATABASE', 'ENTREGA', `FALHA user=${userId} #${String(orderId).slice(-8)} "${productName}"`, {
            error,
        });
    }

    deliveryLocked(orderId, paymentId) {
        this._emit('INFO', 'DATABASE', 'LOCK', `order=#${String(orderId).slice(-8)} payment=${paymentId}`);
    }

    paymentAttempt(userId, orderId, amount, method) {
        this._emit('INFO', 'API', 'PAY', `user=${userId} #${String(orderId).slice(-8)} R$ ${Number(amount).toFixed(2)} ${method}`);
    }

    subscription(userId, planName) {
        this._emit('INFO', 'DATABASE', 'SUB', `user=${userId} plano=${planName}`);
    }
}

module.exports = HanorkLogger;
