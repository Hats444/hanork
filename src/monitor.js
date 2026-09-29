// =============================================================================
// monitor.js — Alertas Telegram + healthcheck interno
// =============================================================================

const logger = require('./config/logger');

const ALERT_COOLDOWN_MS = 5 * 60 * 1000;
const DEFAULT_HEALTH_REPORT_INTERVAL_MS = 2 * 60 * 60 * 1000;
const alertCooldowns    = new Map();

let _bot        = null;
let _adminIds   = [];
let _startedAt  = Date.now();
let _errorCount = 0;
let _botStopped = false; // true durante shutdown — suprime alertas com bot parado

// Erros que NÃO devem gerar alerta (ruído normal de rede/Telegram)
const SILENT_ERRORS = [
    'Bot is not running',
    'bot was blocked by the user',
    'user is deactivated',
    'chat not found',
    'have no rights to send',
    'message is not modified',
    'query is too old',
    'ETIMEOUT',
    'ECONNRESET',
    'ECONNREFUSED',
    'EHOSTUNREACH',
    'Promise timed out',
    '409: Conflict',
    'socket hang up',
];

function resolveHealthReportIntervalMs() {
    const raw = process.env.HEALTH_REPORT_INTERVAL_MS;
    if (raw != null && String(raw).trim() !== '') {
        const n = parseInt(raw, 10);
        if (Number.isFinite(n) && n >= 60 * 60 * 1000) {
            return Math.min(24 * 60 * 60 * 1000, n);
        }
    }
    return DEFAULT_HEALTH_REPORT_INTERVAL_MS;
}

function healthReportLabel(intervalMs) {
    const totalMin = Math.round(intervalMs / 60000);
    if (totalMin < 60) return `${totalMin}min`;
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (!m) return `${h}h`;
    return `${h}h ${m}min`;
}

function isSilent(reason) {
    const msg = String(reason?.message || reason);
    return SILENT_ERRORS.some(s => msg.includes(s));
}

function setBotStopped(val = true) { _botStopped = val; }

function init(bot, adminIds) {
    _bot      = bot;
    _adminIds = Array.isArray(adminIds) ? adminIds : [adminIds];
    logger.info(`Monitor: ativo para ${_adminIds.length} admin(s)`);
}

function escapeMarkdownV1(text) {
    return String(text).replace(/([_*`])/g, '\\$1');
}

async function sendAlert(type, text, { force = false, parseMode = 'Markdown' } = {}) {
    if (!_bot || !_adminIds.length || _botStopped) return;
    const now = Date.now();
    if (!force) {
        const last = alertCooldowns.get(type) || 0;
        if (now - last < ALERT_COOLDOWN_MS) return;
    }
    alertCooldowns.set(type, now);
    for (const adminId of _adminIds) {
        try {
            await _bot.telegram.sendMessage(adminId, text, { parse_mode: parseMode });
        } catch (e) {
            if (parseMode === 'Markdown') {
                try {
                    await _bot.telegram.sendMessage(adminId, text.replace(/[*_`]/g, ''), { parse_mode: undefined });
                    continue;
                } catch { /* fallthrough */ }
            }
            logger.warn(`Monitor: falha ao alertar ${adminId}: ${e.message}`);
        }
    }
}

async function alertCrash(err, origin = 'uncaughtException') {
    _errorCount++;
    await sendAlert('crash_' + origin,
        `🚨 *ERRO CRÍTICO — Hanork Bot*\n\n` +
        `⚠️ *Tipo:* \`${origin}\`\n` +
        `📛 *Erro:* \`${String(err?.message || err).slice(0, 300)}\`\n` +
        `🕐 ${new Date().toLocaleString('pt-BR')}\n` +
        `🔄 *Total erros:* ${_errorCount}\n\n` +
        `_O PM2 vai reiniciar automaticamente._`,
        { force: true }
    );
}

async function alertUnhandledRejection(reason) {
    _errorCount++;
    await sendAlert('unhandled_rejection',
        `⚠️ *Promise não tratada — Hanork Bot*\n\n` +
        `📛 \`${String(reason?.message || reason).slice(0, 300)}\`\n` +
        `🕐 ${new Date().toLocaleString('pt-BR')}\n` +
        `🔄 *Total erros:* ${_errorCount}`
    );
}

async function alertPaymentError(orderId, errMsg) {
    await sendAlert('payment_error',
        `💳 *Erro de Pagamento*\n\n` +
        `🔑 Pedido: \`${String(orderId).slice(-12)}\`\n` +
        `📛 \`${String(errMsg).slice(0, 200)}\`\n` +
        `🕐 ${new Date().toLocaleString('pt-BR')}`
    );
}

async function alertDeliveryFailure(userId, orderId, productName, errMsg) {
    await sendAlert('delivery_' + orderId,
        `📦 *Falha na Entrega*\n\n` +
        `👤 Usuário: \`${userId}\`\n` +
        `🔑 Pedido: \`${String(orderId).slice(-12)}\`\n` +
        `🛍️ ${productName}\n` +
        `📛 \`${String(errMsg).slice(0, 200)}\`\n` +
        `🕐 ${new Date().toLocaleString('pt-BR')}\n\n` +
        `_Verifique se o arquivo existe em \`produtos/\`._`,
        { force: true }
    );
}

async function alertBackupFailure(errMsg) {
    await sendAlert('backup_failure',
        `💾 *Falha no Backup*\n\n` +
        `📛 \`${String(errMsg).slice(0, 200)}\`\n` +
        `🕐 ${new Date().toLocaleString('pt-BR')}`
    );
}

async function alertStartup(username) {
    const user = escapeMarkdownV1(String(username || 'bot').replace('@', ''));
    await sendAlert('startup',
        `✅ *Bot Online — Hanork*\n\n` +
        `🤖 @${user}\n` +
        `🕐 ${new Date().toLocaleString('pt-BR')}\n` +
        `🖥️ Node ${escapeMarkdownV1(process.version)} | PID ${process.pid}`,
        { force: true }
    );
}

async function alertHealthReport(stats = {}) {
    if (!_bot || !_adminIds.length || _botStopped) return;

    const uptime = Math.floor((Date.now() - _startedAt) / 1000);
    const h = Math.floor(uptime / 3600);
    const m = Math.floor((uptime % 3600) / 60);
    const memMB = (process.memoryUsage().rss / 1024 / 1024).toFixed(1);
    const now = Date.now();
    alertCooldowns.set('health_report', now);

    let botUsername = process.env.BOT_USERNAME || '';
    try {
        const me = await _bot.telegram.getMe();
        botUsername = me.username || botUsername;
    } catch {
        /* ignore */
    }

    const date = new Date().toISOString().slice(0, 10);
    const reportLabel = healthReportLabel(resolveHealthReportIntervalMs());
    let html = '';
    try {
        const { buildHanorkOpsReportCompact } = require('./services/ops/HanorkOpsReportBuilder');
        html = await buildHanorkOpsReportCompact({
            date,
            botUsername,
            label: reportLabel,
            extra: {
                uptimeH: h,
                uptimeM: m,
                memMB,
                errorCount: _errorCount,
                revenue: stats.revenue,
                orders: stats.orders,
            },
        });
    } catch (e) {
        logger.warn('Monitor health report (ops builder):', e.message);
        html =
            `<b>📊 Hanork — ${reportLabel}</b>\n\n` +
            `⏱️ ${h}h ${m}min · 💾 ${memMB} MB · ❌ ${_errorCount}\n` +
            (stats.users != null ? `👥 ${stats.users} usuários\n` : '') +
            (stats.revenue != null ? `💰 Hoje R$ ${Number(stats.revenue).toFixed(2)}\n` : '') +
            `<i>${new Date().toLocaleString('pt-BR')}</i>`;
    }

    const { deliverOpsReport } = require('./services/ops/deliverOpsReport');
    for (const adminId of _adminIds) {
        try {
            await deliverOpsReport(_bot.telegram, adminId, html, {
                singleMessage: true,
                requirePhoto: true,
            });
        } catch (e) {
            logger.warn(`Monitor: falha relatório ${reportLabel} ${adminId}:`, e.message);
            try {
                await _bot.telegram.sendMessage(adminId, html.replace(/<[^>]+>/g, '').slice(0, 3500));
            } catch {
                /* ignore */
            }
        }
    }
}

function startHealthCheck(getStats) {
    const healthReports = process.env.HEALTH_REPORT_ENABLED !== '0'
        && process.env.HEALTH_REPORT_ENABLED !== 'false';

    if (healthReports) {
        const intervalMs = resolveHealthReportIntervalMs();
        logger.info(`Monitor: relatório ops a cada ${healthReportLabel(intervalMs)}`, { intervalMs });
        setInterval(async () => {
            try {
                const stats = typeof getStats === 'function' ? await getStats() : {};
                await alertHealthReport(stats);
            } catch (e) { logger.warn('Monitor healthcheck:', e.message); }
        }, intervalMs);
    }

    // Heartbeat no terminal.log — silêncio pós-boot não parece “morto”
    const heartbeatMs = Math.max(60000, parseInt(process.env.HANORK_HEARTBEAT_MS || '900000', 10));
    setInterval(() => {
        const memMB = (process.memoryUsage().rss / 1024 / 1024).toFixed(1);
        logger.info('Monitor: bot ativo', {
            pid: process.pid,
            uptimeSec: Math.round(process.uptime()),
            memMB,
        });
    }, heartbeatMs);

    // Alerta memória alta (> 400 MB) a cada 10 min
    setInterval(async () => {
        const memMB = process.memoryUsage().rss / 1024 / 1024;
        if (memMB > 400) {
            await sendAlert('high_memory',
                `⚠️ *Memória Alta — Hanork Bot*\n\n` +
                `💾 ${memMB.toFixed(1)} MB\n` +
                `🕐 ${new Date().toLocaleString('pt-BR')}`
            );
        }
    }, 10 * 60 * 1000);
}

function isBrokenPipe(err) {
    const code = err?.code;
    return code === 'EPIPE' || code === 'EIO';
}

function registerGlobalHandlers() {
    process.on('uncaughtException', async (err, origin) => {
        // Terminal/pipe fechado (tail -F, restart hanork-ctl) — não derrubar o bot nem entrar em loop fatal.
        if (isBrokenPipe(err)) return;
        logger.fatal(`FATAL [${origin}]: ${err?.stack || err}`);
        await alertCrash(err, origin);
        setTimeout(() => process.exit(1), 3000);
    });

    process.on('unhandledRejection', async (reason) => {
        if (isSilent(reason)) return; // ruído normal — ignorar
        logger.error(`unhandledRejection: ${reason?.stack || reason}`);
        await alertUnhandledRejection(reason);
    });

    logger.info('Monitor: handlers globais registrados');
}

module.exports = {
    init,
    setBotStopped,
    registerGlobalHandlers,
    startHealthCheck,
    alertCrash,
    alertUnhandledRejection,
    alertPaymentError,
    alertDeliveryFailure,
    alertBackupFailure,
    alertStartup,
    alertHealthReport,
};
