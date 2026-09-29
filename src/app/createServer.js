'use strict';

/**
 * Express — site, dashboard, checkout público, webhook Mercado Pago (V4 SP-1 / M1).
 */
const path = require('path');
const fs = require('fs');
const express = require('express');
const { correlationContext } = require('../infrastructure');
const { startHttpRateMapCleanupScheduler } = require('../jobs/schedulers/rateLimitCleanupScheduler');
const HealthCheck = require('../modules/health/HealthCheck');
const { applySecurityHeaders, vitrineRateLimit } = require('../modules/security/httpSecurity');
const adminRouter = require('../modules/auth/adminRouter');
const publicCheckoutRouter = require('../modules/checkout/publicCheckoutRouter');
const mpGoRouter = require('../modules/payment/mpGoRouter');
const { requireAuth } = require('../modules/auth/authMiddleware');
const { handleMpWebhook } = require('../modules/payment/mpWebhookHandler');
const { logDashboardUrls, startLanNetworkRefresh } = require('../utils/dashboardNetwork');

const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');
const SITE_HTML = path.join(__dirname, '..', '..', 'hanork.html');

/**
 * @param {{ bot, prisma, logger, deferBackground: Function, webhookPaymentDedup: object }} deps
 * @returns {import('express').Express}
 */
function createExpressApp(deps) {
    const { bot, prisma, logger, deferBackground, webhookPaymentDedup } = deps;
    const app = express();

    app.use(express.json({ limit: '50kb' }));
    app.use(correlationContext.middleware());

    const httpRateMap = new Map();
    app.use((req, res, next) => {
        const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
        const now = Date.now();
        const entry = httpRateMap.get(ip) || { count: 0, ts: now };
        if (now - entry.ts > 60000) {
            entry.count = 0;
            entry.ts = now;
        }
        entry.count++;
        httpRateMap.set(ip, entry);
        if (entry.count > 120) return res.status(429).json({ error: 'Too many requests' });
        next();
    });
    startHttpRateMapCleanupScheduler({ httpRateMap, log: logger });

    app.use(applySecurityHeaders);
    app.use(vitrineRateLimit);
    app.use(express.static(PUBLIC_DIR, { index: false, dotfiles: 'deny' }));
    app.use((req, res, next) => {
        const norm = req.path.toLowerCase().replace(/\/+/g, '/');
        const blocked = ['.env', '.db', '.db-shm', '.db-wal', '.lock', 'node_modules', '/src'];
        if (blocked.some((b) => norm.includes(b))) return res.status(403).json({ error: 'Forbidden' });
        next();
    });

    app.use(adminRouter);
    app.use(publicCheckoutRouter);
    app.use(mpGoRouter);

    for (const mpPath of ['/mp/success', '/mp/failure', '/mp/pending']) {
        app.get(mpPath, (req, res) => {
            res.status(200).send(
                '<html><body style="font-family:sans-serif;text-align:center;padding:2rem">' +
                    '<h2>Pagamento Mercado Pago</h2><p>Você pode fechar esta página e voltar ao Telegram.</p>' +
                    '<p>Use <b>Já paguei</b> no bot para confirmar.</p></body></html>'
            );
        });
    }

    app.get('/', (req, res) => {
        if (fs.existsSync(SITE_HTML)) return res.sendFile(SITE_HTML);
        res.json({ status: 'Hanork Bot API', uptime: process.uptime() });
    });

    app.get('/health', async (req, res) => {
        try {
            const status = await HealthCheck.getStatus();
            res.status(status.healthy ? 200 : 503).json(status);
        } catch (e) {
            res.status(503).json({ healthy: false, error: e.message });
        }
    });

    app.get('/health/live', (req, res) => {
        res.status(200).send('OK');
    });

    app.get('/metrics', async (req, res) => {
        const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || '';
        const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
        const hasAuth = !!(req.headers.authorization || req.headers.cookie?.includes('dashboard_token'));
        if (!isLocal && !hasAuth && process.env.NODE_ENV === 'production') {
            return res.status(403).send('# Forbidden');
        }
        try {
            const body = await HealthCheck.getPrometheusText();
            res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
            res.send(body);
        } catch (e) {
            res.status(500).send(`# Error: ${e.message}\n`);
        }
    });

    app.get('/dashboard', (req, res) => res.redirect('/admin'));

    app.get('/api/stats', requireAuth, async (req, res) => {
        try {
            const today = await prisma.finance.getCashFlowSummary('today');
            const week = await prisma.finance.getCashFlowSummary('week');
            const month = await prisma.finance.getCashFlowSummary('month');
            const goals = await prisma.goals.getCurrent('monthly');

            const users = await prisma.user.count();
            const orders = await prisma.order.count({ where: { status: 'DELIVERED' } });
            const pending = await prisma.order.count({ where: { status: 'WAITING_PAYMENT' } });
            const abandoned = await prisma.abandonedCart.stats();

            res.json({
                timestamp: new Date().toISOString(),
                today: { income: today.income, expense: today.expense, balance: today.balance },
                week: { income: week.income, balance: week.balance },
                month: { income: month.income, balance: month.balance },
                users,
                orders,
                pending,
                abandoned,
                goals: goals
                    ? {
                          target: goals.goal_amount,
                          achieved: goals.achieved_amount,
                          percent: ((goals.achieved_amount / goals.goal_amount) * 100).toFixed(1),
                          completed: goals.completed,
                      }
                    : null,
                carts: 0,
                uptime: process.uptime(),
            });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.get('/api/sales/daily', requireAuth, (req, res) => {
        try {
            const db = require('../config/database-sqlite').connect();
            const data = db
                .prepare(
                    `
            SELECT date(created_at) as date, SUM(amount) as total, COUNT(*) as orders
            FROM cash_flow 
            WHERE type='income' AND date(created_at) >= date('now', '-7 days')
            GROUP BY date(created_at)
            ORDER BY date(created_at) ASC
        `
                )
                .all();
            res.json(data);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.get('/api/products/top', requireAuth, (req, res) => {
        try {
            const { parseDashboardTenant } = require('../modules/dashboard/dashboardTenant');
            const DashboardService = require('../modules/dashboard/DashboardService');
            const scope = parseDashboardTenant(req);
            const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);
            res.json(DashboardService.getTopProducts(limit, scope));
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/webhooks/mercadopago', (req, res) => {
        handleMpWebhook(req, res, { bot, prisma, logger, deferBackground, webhookPaymentDedup });
    });

    return app;
}

/**
 * @param {import('express').Express} app
 * @param {{ port?: number, logger: object }} options
 */
function startExpressServer(app, options = {}) {
    const port = options.port ?? parseInt(process.env.PORT || '3000', 10);
    const logger = options.logger;

    app.use((req, res) => {
        res.status(404).json({ error: 'Not found', path: req.path });
    });

    app.use((err, req, res, next) => {
        logger.error(`[EXPRESS] Unhandled error on ${req.method} ${req.path}: ${err.message}`);
        res.status(500).json({ error: 'Internal server error' });
    });

    app.listen(port, '0.0.0.0', () => {
        logger.info(`Express server na porta ${port} (0.0.0.0 — localhost + rede local)`);
        logDashboardUrls(logger, port);
        startLanNetworkRefresh(logger);
    });
}

module.exports = {
    createExpressApp,
    startExpressServer,
};
