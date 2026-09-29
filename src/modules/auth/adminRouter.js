/**
 * adminRouter — Painel Admin Web + API REST protegida
 * Rotas:
 *   POST /admin/login           — autenticar
 *   POST /admin/logout          — revogar sessão
 *   GET  /admin                 — dashboard SPA
 *   GET  /api/v1/stats          — estatísticas
 *   GET  /api/v1/orders         — pedidos (paginado)
 *   GET  /api/v1/products       — produtos
 *   POST /api/v1/products       — criar produto
 *   PUT  /api/v1/products/:id   — editar produto
 *   DELETE /api/v1/products/:id — remover produto
 *   GET  /api/v1/users          — usuários (paginado)
 *   GET  /api/v1/coupons        — cupons
 *   POST /api/v1/coupons        — criar cupom
 *   DELETE /api/v1/coupons/:id  — remover cupom
 *   GET  /api/v1/groups         — grupos onde o bot está
 *   GET  /api/v1/analytics/funnel — funil de conversão
 *   GET  /api/v1/analytics/sales  — vendas por período
 *   POST /api/v1/auth/login       — login JSON (Flutter panel)
 *   GET  /api/v1/mobile/home      — dashboard agregado mobile
 *   GET  /api/v1/settings         — flags read-only
 */
const express = require('express');
const router = express.Router();
const AuthService = require('./AuthService');
const path = require('path');
const fs = require('fs');
const { requireAuth } = require('./authMiddleware');
const { attachDashboardTenant } = require('./dashboardTenantMiddleware');
const { clause: tenantClause, findByIdInScope, validateDashboardTenantSwitch, requireMutationScope } = require('../dashboard/dashboardTenant');
const logger = require('../../config/logger');
const { withFormatField } = require('../../utils/productFormat');
const { registerMobileApi } = require('./mobileApi');

const dashAuth = [requireAuth, attachDashboardTenant];

function tenantScope(req) {
    return req.tenantScope || { mode: 'legacy', tenantId: null };
}

function rejectUnlessMutationScope(req, res) {
    const check = requireMutationScope(tenantScope(req));
    if (!check.ok) {
        res.status(check.status).json({ error: check.error });
        return false;
    }
    return true;
}

// ── cookie-parser inline (evita dep extra) ────────────────────────────────────
function parseCookies(req) {
  const raw = req.headers.cookie || '';
  return Object.fromEntries(raw.split(';').map(c => {
    const [k, ...v] = c.trim().split('=');
    return [k?.trim(), decodeURIComponent(v.join('=') || '')];
  }).filter(([k]) => k));
}

router.use((req, res, next) => {
  req.cookies = parseCookies(req);
  next();
});

registerMobileApi(router);

// ── Helpers ───────────────────────────────────────────────────────────────────
function getDb() {
  return require('../../../src/config/database-sqlite').connect();
}

function getIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
}

// ── LOGIN ─────────────────────────────────────────────────────────────────────
router.get('/admin/login', (req, res) => {
  const expired = req.query.expired ? '<p class="error">Sessão expirada. Faça login novamente.</p>' : '';
  const error = req.query.error ? '<p class="error">Usuário ou senha incorretos.</p>' : '';
  res.send(loginPage(expired + error));
});

function cookieFlags() {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `HttpOnly; SameSite=Strict${secure}`;
}

router.post('/admin/login', express.urlencoded({ extended: false }), async (req, res) => {
  const ip = getIp(req);
  const limCheck = AuthService.checkLoginAttempts(ip);
  if (!limCheck.allowed) {
    return res.status(429).send(loginPage(`<p class="error">Muitas tentativas. Tente em ${limCheck.retryAfter}s.</p>`));
  }

  const { username, password } = req.body;
  const ADMIN_USER = process.env.DASHBOARD_USER || 'admin';
  const ADMIN_PASS_HASH = process.env.DASHBOARD_PASS_HASH || '';
  const ADMIN_PASS_PLAIN = process.env.DASHBOARD_PASS || '';
  const isProd = process.env.NODE_ENV === 'production';

  let ok = false;
  if (ADMIN_PASS_HASH) {
    ok = username === ADMIN_USER && await AuthService.verifyPassword(password, ADMIN_PASS_HASH);
  } else if (ADMIN_PASS_PLAIN) {
    if (isProd) {
      logger.error('[AUTH] DASHBOARD_PASS em texto puro bloqueado em produção');
      return res.status(503).send(
        loginPage('<p class="error">Em produção use <code>DASHBOARD_PASS_HASH</code>. Rode: <code>npm run hash:dashboard -- "sua_senha"</code></p>')
      );
    }
    ok = username === ADMIN_USER && password === ADMIN_PASS_PLAIN;
    if (ok) logger.warn('[AUTH] DASHBOARD_PASS_HASH não definido — usando senha em texto puro. Gere com npm run hash:dashboard');
  } else if (isProd) {
    logger.error('[AUTH] DASHBOARD_PASS ou DASHBOARD_PASS_HASH obrigatório em produção');
    return res.status(503).send(loginPage('<p class="error">Painel desativado: configure DASHBOARD_PASS no .env</p>'));
  }

  if (!ok) {
    AuthService.recordFailedLogin(ip);
    logger.warn(`[AUTH] Login falhou: user=${username} ip=${ip}`);
    return res.redirect('/admin/login?error=1');
  }

  AuthService.recordSuccessLogin(ip);
  const token = AuthService.createSession({ id: ADMIN_USER, role: 'admin' });
  logger.info(`[AUTH] Login bem-sucedido: user=${username} ip=${ip}`);

  res.setHeader('Set-Cookie', `dashboard_token=${token}; ${cookieFlags()}; Max-Age=28800; Path=/`);
  res.redirect('/admin');
});

function handleAdminLogout(req, res) {
  const token = req.cookies?.dashboard_token || req.headers['authorization']?.slice(7);
  if (token) AuthService.revokeSession(token);
  res.setHeader('Set-Cookie', `dashboard_token=; ${cookieFlags()}; Max-Age=0; Path=/`);
  res.redirect('/admin/login');
}

router.post('/admin/logout', handleAdminLogout);
router.get('/admin/logout', handleAdminLogout);

// ── Gerar hash de senha (setup único) ─────────────────────────────────────────
router.get('/admin/setup', requireAuth, async (req, res) => {
  const { password } = req.query;
  if (!password) return res.json({ error: 'Passe ?password=suasenha para gerar o hash' });
  const hash = await AuthService.hashPassword(password);
  res.json({ hash, instruction: `Coloque DASHBOARD_PASS_HASH=${hash} no .env e remova DASHBOARD_PASS` });
});

// ── DASHBOARD SPA ─────────────────────────────────────────────────────────────
router.get('/admin', requireAuth, (req, res) => {
  // Servir novo dashboard aprimorado se existir, senão fallback para versão inline
  const newDashboardPath = path.join(__dirname, '../../../public/admin-dashboard.html');
  if (fs.existsSync(newDashboardPath)) {
    return res.sendFile(newDashboardPath);
  }
  res.send(dashboardPage());
});

// ── DASHBOARD API (SaaS: ?tenant_id=legacy|all|ID) ────────────────────────────
const DashboardService = require('../dashboard/DashboardService');
const HealthCheck = require('../health/HealthCheck');
const { getDashboardNetwork, resolveAccessFromRequest, formatAdminAccessHtml } = require('../../utils/dashboardNetwork');

router.get('/api/dashboard/context', dashAuth, (req, res) => {
  try {
    const port = parseInt(process.env.PORT || '3000', 10);
    res.json({
      ...DashboardService.getContext(),
      current: req.tenantScope,
      network: {
        ...getDashboardNetwork(port),
        access: resolveAccessFromRequest(req, port),
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/api/dashboard/tenant', dashAuth, express.json(), (req, res) => {
  const check = validateDashboardTenantSwitch(req.body?.tenant_id ?? 'legacy');
  if (!check.ok) {
    return res.status(400).json({ error: check.error || 'tenant_id inválido' });
  }
  res.setHeader('Set-Cookie', `dashboard_tenant=${encodeURIComponent(check.value)}; ${cookieFlags()}; Max-Age=2592000; Path=/`);
  res.json({ ok: true, tenant_id: check.value });
});

router.get('/api/dashboard/kpis', dashAuth, async (req, res) => {
  try {
    res.json(DashboardService.getKPIs(req.tenantScope));
  } catch (e) {
    logger.error('[DASHBOARD] Erro ao buscar KPIs:', e.message);
    res.status(500).json({ error: 'Erro ao carregar métricas' });
  }
});

router.get('/api/dashboard/chart', dashAuth, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    res.json(DashboardService.getSalesChart(days, req.tenantScope));
  } catch (e) {
    logger.error('[DASHBOARD] Erro ao buscar chart:', e.message);
    res.status(500).json({ error: 'Erro ao carregar gráfico' });
  }
});

router.get('/api/dashboard/orders', dashAuth, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    res.json(DashboardService.getRecentOrders(limit, req.tenantScope));
  } catch (e) {
    logger.error('[DASHBOARD] Erro ao buscar pedidos:', e.message);
    res.status(500).json({ error: 'Erro ao carregar pedidos' });
  }
});

router.get('/api/dashboard/funnel', dashAuth, async (req, res) => {
  try {
    res.json(DashboardService.getFunnel(req.tenantScope));
  } catch (e) {
    logger.error('[DASHBOARD] Erro ao buscar funil:', e.message);
    res.status(500).json({ error: 'Erro ao carregar funil' });
  }
});

router.get('/api/dashboard/top-products', dashAuth, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    res.json(DashboardService.getTopProducts(limit, req.tenantScope));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/api/dashboard/refresh', dashAuth, async (req, res) => {
  try {
    DashboardService.clearCache();
    try {
      const OpsDashboardService = require('../dashboard/OpsDashboardService');
      OpsDashboardService.clearOpsCache?.();
    } catch { /* ignore */ }
    res.json({ success: true, message: 'Cache limpo' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── OPS / Command Center (Telegram + WhatsApp + filas + alertas) ─────────────
router.get('/api/ops/summary', dashAuth, async (req, res) => {
  try {
    const OpsDashboardService = require('../dashboard/OpsDashboardService');
    const force = req.query.nocache === '1' || req.query.force === '1';
    const data = await Promise.race([
      OpsDashboardService.getFullOpsSummary({ force, nocache: force }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Ops summary timeout')), 8000)
      ),
    ]);
    res.json(data);
  } catch (e) {
    logger.warn('[OPS API] summary failed:', e.message);
    res.status(e.message.includes('timeout') ? 504 : 500).json({ error: e.message });
  }
});

router.get('/api/ops/health', dashAuth, async (req, res) => {
  try {
    const status = await HealthCheck.getStatus();
    res.json(status);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── TODAS as rotas /api/v1/* exigem auth + tenant ─────────────────────────────
router.use('/api/v1', requireAuth, attachDashboardTenant);

// ── STATS ─────────────────────────────────────────────────────────────────────
router.get('/api/v1/stats', (req, res) => {
  try {
    const kpis = DashboardService.getKPIs(req.tenantScope);
    res.json({
      revenue: kpis.revenue,
      counts: {
        users: kpis.users.total,
        orders_paid: kpis.orders.today,
        orders_pending: kpis.orders.pending,
        products_active: kpis.products.active,
        groups: getDb().prepare(`SELECT COUNT(*) as c FROM telegram_groups WHERE active=1`).get()?.c || 0,
        tickets_open: (() => {
          const s = tenantScope(req);
          const tt = tenantClause('tenant_id', s, 't');
          return getDb().prepare(`SELECT COUNT(*) as c FROM support_tickets t WHERE t.status='open'${tt.sql}`).get(...tt.params)?.c || 0;
        })(),
      },
      avgTicket: '0.00',
      uptime: process.uptime(),
      scope: req.tenantScope,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── ANALYTICS — vendas diárias (últimos N dias) ───────────────────────────────
router.get('/api/v1/analytics/sales', (req, res) => {
  try {
    const db = getDb();
    const s = tenantScope(req);
    const ot = tenantClause('tenant_id', s);
    const days = Math.min(parseInt(req.query.days) || 30, 90);
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const data = db.prepare(`
            SELECT date(created_at) as date,
                   COUNT(*) as orders,
                   COALESCE(SUM(total),0) as revenue
            FROM orders
            WHERE status IN ('PAID','DELIVERED') AND date(created_at) >= ?${ot.sql}
            GROUP BY date(created_at)
            ORDER BY date(created_at) ASC
        `).all(since, ...ot.params);
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── ANALYTICS — funil de conversão ───────────────────────────────────────────
router.get('/api/v1/analytics/funnel', (req, res) => {
  try {
    const db = getDb();
    const s = tenantScope(req);
    const ot = tenantClause('tenant_id', s, 'o');
    const at = tenantClause('tenant_id', s, 'ac');
    const days = Math.min(parseInt(req.query.days) || 30, 90);
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const added = db.prepare(`SELECT COUNT(DISTINCT ac.telegram_id) as c FROM active_carts ac WHERE ac.added_at >= ?${at.sql}`).get(since, ...at.params)?.c || 0;
    const checkout = db.prepare(`SELECT COUNT(DISTINCT o.user_id) as c FROM orders o WHERE date(o.created_at) >= ?${ot.sql}`).get(since, ...ot.params)?.c || 0;
    const paid = db.prepare(`SELECT COUNT(DISTINCT o.user_id) as c FROM orders o WHERE o.status IN ('PAID','DELIVERED') AND date(o.created_at) >= ?${ot.sql}`).get(since, ...ot.params)?.c || 0;
    res.json([
      { stage: 'Adicionou ao carrinho', count: added },
      { stage: 'Iniciou checkout', count: checkout },
      { stage: 'Pagou', count: paid },
    ]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});


// ── ANALYTICS — conversão completa (Hanork v3, aditivo) ─────────────────────
router.get('/api/v1/analytics/conversion', (req, res) => {
  try {
    const { conversionAnalytics } = require('../../services/ConversionAnalyticsService');
    const days = Math.min(parseInt(req.query.days) || 30, 90);
    const lost = conversionAnalytics.getLostUsers(null, 20);
    res.json({
      summary: conversionAnalytics.getSummary(null, days),
      funnel: conversionAnalytics.getFunnel(null, days),
      lostUsers: {
        counts: lost.counts,
        samples: {
          noPurchase: lost.noPurchase,
          abandonedCart: lost.abandonedCart,
          pixUnpaid: lost.pixUnpaid,
          inactive30: lost.inactive30,
        },
      },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PRODUCTS ──────────────────────────────────────────────────────────────────
router.get('/api/v1/products', (req, res) => {
  try {
    const db = getDb();
    const s = tenantScope(req);
    const pt = tenantClause('tenant_id', s);
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = (page - 1) * limit;
    const search = req.query.q ? `%${req.query.q}%` : '%';
    const products = db
      .prepare(
        `SELECT * FROM products WHERE (name LIKE ? OR category LIKE ?)${pt.sql} ORDER BY id DESC LIMIT ? OFFSET ?`
      )
      .all(search, search, ...pt.params, limit, offset);
    const total = db
      .prepare(`SELECT COUNT(*) as c FROM products WHERE (name LIKE ? OR category LIKE ?)${pt.sql}`)
      .get(search, search, ...pt.params)?.c || 0;
    res.json({
      products: products.map(withFormatField),
      total,
      page,
      pages: Math.ceil(total / limit),
      scope: s,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/api/v1/products/:id', (req, res) => {
  try {
    const db = getDb();
    const s = tenantScope(req);
    const existing = findByIdInScope(db, 'products', req.params.id, s);
    if (!existing) return res.status(404).json({ error: 'Produto não encontrado neste escopo' });
    res.json(withFormatField(existing));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/v1/products', express.json(), (req, res) => {
  try {
    if (!rejectUnlessMutationScope(req, res)) return;
    const db = getDb();
    const s = tenantScope(req);
    const { name, price, description = '', category = 'geral', stock = 999, file_url = '', photo_url = '', active } = req.body;
    if (!name || !price) return res.status(400).json({ error: 'name e price são obrigatórios' });
    const tenantId = s.mode === 'tenant' ? s.tenantId : null;
    const activeVal = active !== undefined ? (active ? 1 : 0) : 1;
    const result = db
      .prepare(
        `INSERT INTO products (name, price, description, category, stock, file_url, photo_url, active, tenant_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(name, Number(price), description, category, Number(stock), file_url, photo_url, activeVal, tenantId);
    logger.info(`[ADMIN API] Produto criado: ${name} (id=${result.lastInsertRowid}) tenant=${tenantId}`);
    res.status(201).json({ id: result.lastInsertRowid, name, price: Number(price), tenant_id: tenantId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/api/v1/products/:id', express.json(), (req, res) => {
  try {
    if (!rejectUnlessMutationScope(req, res)) return;
    const db = getDb();
    const s = tenantScope(req);
    const { id } = req.params;
    const existing = findByIdInScope(db, 'products', id, s);
    if (!existing) return res.status(404).json({ error: 'Produto não encontrado neste escopo' });
    const { name, price, description, category, stock, file_url, photo_url, active } = req.body;
    const pt = tenantClause('tenant_id', s);
    const result = db.prepare(`UPDATE products SET name=COALESCE(?,name), price=COALESCE(?,price), description=COALESCE(?,description), category=COALESCE(?,category), stock=COALESCE(?,stock), file_url=COALESCE(?,file_url), photo_url=COALESCE(?,photo_url), active=COALESCE(?,active) WHERE id=?${pt.sql}`)
      .run(name, price !== undefined ? Number(price) : null, description, category, stock !== undefined ? Number(stock) : null, file_url, photo_url, active !== undefined ? (active ? 1 : 0) : null, Number(id), ...pt.params);
    if (!result.changes) return res.status(404).json({ error: 'Produto não encontrado neste escopo' });
    logger.info(`[ADMIN API] Produto atualizado: id=${id} scope=${s.mode}`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/api/v1/products/:id', (req, res) => {
  try {
    if (!rejectUnlessMutationScope(req, res)) return;
    const db = getDb();
    const s = tenantScope(req);
    const existing = findByIdInScope(db, 'products', req.params.id, s);
    if (!existing) return res.status(404).json({ error: 'Produto não encontrado neste escopo' });
    const pt = tenantClause('tenant_id', s);
    const result = db.prepare(`UPDATE products SET active=0 WHERE id=?${pt.sql}`).run(Number(req.params.id), ...pt.params);
    if (!result.changes) return res.status(404).json({ error: 'Produto não encontrado neste escopo' });
    logger.info(`[ADMIN API] Produto desativado: id=${req.params.id} scope=${s.mode}`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── ORDERS ────────────────────────────────────────────────────────────────────
router.get('/api/v1/orders', (req, res) => {
  try {
    const db = getDb();
    const s = tenantScope(req);
    const ot = tenantClause('tenant_id', s, 'o');
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = (page - 1) * limit;
    const status = req.query.status || null;
    const base = `SELECT o.*, u.username, u.first_name FROM orders o LEFT JOIN users u ON u.id=o.user_id WHERE 1=1${ot.sql}`;
    const orders = status
      ? db.prepare(`${base} AND o.status=? ORDER BY o.created_at DESC LIMIT ? OFFSET ?`).all(...ot.params, status, limit, offset)
      : db.prepare(`${base} ORDER BY o.created_at DESC LIMIT ? OFFSET ?`).all(...ot.params, limit, offset);
    const countQ = status
      ? db.prepare(`SELECT COUNT(*) as c FROM orders o WHERE o.status=?${ot.sql}`).get(status, ...ot.params)
      : db.prepare(`SELECT COUNT(*) as c FROM orders o WHERE 1=1${ot.sql}`).get(...ot.params);
    res.json({ orders, total: countQ?.c || 0, page, pages: Math.ceil((countQ?.c || 0) / limit), scope: s });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── USERS ─────────────────────────────────────────────────────────────────────
router.get('/api/v1/users', (req, res) => {
  try {
    const db = getDb();
    const s = tenantScope(req);
    const ut = tenantClause('tenant_id', s, 'u');
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = (page - 1) * limit;
    const q = req.query.q ? `%${req.query.q}%` : '%';
    const users = db
      .prepare(
        `SELECT u.*, (SELECT COUNT(*) FROM orders WHERE user_id=u.id AND status IN ('PAID','DELIVERED')) as orders_count,
         (SELECT COALESCE(SUM(total),0) FROM orders WHERE user_id=u.id AND status IN ('PAID','DELIVERED')) as total_spent
         FROM users u WHERE (u.username LIKE ? OR u.first_name LIKE ? OR u.telegram_id LIKE ?)${ut.sql}
         ORDER BY u.created_at DESC LIMIT ? OFFSET ?`
      )
      .all(q, q, q, ...ut.params, limit, offset);
    const total = db
      .prepare(
        `SELECT COUNT(*) as c FROM users u WHERE (u.username LIKE ? OR u.first_name LIKE ? OR u.telegram_id LIKE ?)${ut.sql}`
      )
      .get(q, q, q, ...ut.params)?.c || 0;
    res.json({ users, total, page, pages: Math.ceil(total / limit), scope: s });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── COUPONS ───────────────────────────────────────────────────────────────────
router.get('/api/v1/coupons', (req, res) => {
  try {
    const db = getDb();
    const s = tenantScope(req);
    const ct = tenantClause('tenant_id', s);
    const coupons = db.prepare(`SELECT * FROM coupons WHERE 1=1${ct.sql} ORDER BY created_at DESC`).all(...ct.params);
    res.json(coupons);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/v1/coupons', express.json(), (req, res) => {
  try {
    if (!rejectUnlessMutationScope(req, res)) return;
    const db = getDb();
    const s = tenantScope(req);
    const { code, type = 'percent', value, max_uses = 100, min_total = 0, expires_at } = req.body;
    if (!code || !value) return res.status(400).json({ error: 'code e value são obrigatórios' });
    const tenantId = s.mode === 'tenant' ? s.tenantId : null;
    db.prepare(
      `INSERT OR IGNORE INTO coupons (code, type, value, max_uses, min_total, active, expires_at, tenant_id) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
    ).run(code.toUpperCase(), type, Number(value), Number(max_uses), Number(min_total), expires_at || null, tenantId);
    logger.info(`[ADMIN API] Cupom criado: ${code}`);
    res.status(201).json({ ok: true, code: code.toUpperCase() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/api/v1/coupons/:id', express.json(), (req, res) => {
  try {
    if (!rejectUnlessMutationScope(req, res)) return;
    const db = getDb();
    const s = tenantScope(req);
    const existing = findByIdInScope(db, 'coupons', req.params.id, s);
    if (!existing) return res.status(404).json({ error: 'Cupom não encontrado neste escopo' });
    const { active } = req.body;
    const ct = tenantClause('tenant_id', s);
    const result = db.prepare(`UPDATE coupons SET active=? WHERE id=?${ct.sql}`).run(active ? 1 : 0, Number(req.params.id), ...ct.params);
    if (!result.changes) return res.status(404).json({ error: 'Cupom não encontrado neste escopo' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/api/v1/coupons/:id', (req, res) => {
  try {
    if (!rejectUnlessMutationScope(req, res)) return;
    const db = getDb();
    const s = tenantScope(req);
    const existing = findByIdInScope(db, 'coupons', req.params.id, s);
    if (!existing) return res.status(404).json({ error: 'Cupom não encontrado neste escopo' });
    const ct = tenantClause('tenant_id', s);
    const result = db.prepare(`DELETE FROM coupons WHERE id=?${ct.sql}`).run(Number(req.params.id), ...ct.params);
    if (!result.changes) return res.status(404).json({ error: 'Cupom não encontrado neste escopo' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GROUPS ────────────────────────────────────────────────────────────────────
router.get('/api/v1/groups', (req, res) => {
  try {
    const db = getDb();
    let groups;
    try {
      groups = db
        .prepare(
          `SELECT g.*, (SELECT COUNT(*) FROM group_members WHERE group_chat_id=g.chat_id AND active=1) as member_count
           FROM telegram_groups g WHERE g.active=1 AND g.bot_is_admin=1 ORDER BY g.updated_at DESC`
        )
        .all();
    } catch {
      groups = db
        .prepare(
          `SELECT g.*, 0 as member_count FROM telegram_groups g
           WHERE g.active=1 AND g.bot_is_admin=1 ORDER BY g.updated_at DESC`
        )
        .all();
    }
    res.json(groups);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── TENANTS (SaaS) ────────────────────────────────────────────────────────────
router.get('/api/v1/tenants', (req, res) => {
  try {
    const TenantService = require('../tenant/TenantService');
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    res.json(TenantService.getAll({ page, limit }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/api/v1/tenants/:id', (req, res) => {
  try {
    const TenantService = require('../tenant/TenantService');
    const t = TenantService.getById(req.params.id);
    if (!t) return res.status(404).json({ error: 'Tenant não encontrado' });
    const stats = TenantService.getStats(t.id);
    const plan = TenantService.getPlan(t.plan);
    const prod = TenantService.checkProductLimit(t.id);
    const ord = TenantService.checkOrderLimit(t.id);
    const siteBase = (process.env.SITE_HANORK || '').replace(/\/$/, '');
    res.json({
      ...t,
      stats,
      plan,
      limits: { products: prod, orders: ord },
      vitrine: siteBase ? `${siteBase}/loja/${t.slug}` : `/loja/${t.slug}`,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/api/v1/tenants/:id', express.json(), (req, res) => {
  try {
    const TenantService = require('../tenant/TenantService');
    const { plan, active, plan_expires_at } = req.body;
    TenantService.update(Number(req.params.id), { plan, active, plan_expires_at });
    logger.info(`[ADMIN API] Tenant atualizado: id=${req.params.id}`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/api/v1/tenants/:id', (req, res) => {
  try {
    const TenantService = require('../tenant/TenantService');
    TenantService.delete(Number(req.params.id));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PLANS ─────────────────────────────────────────────────────────────────────
router.get('/api/v1/plans', (req, res) => {
  try {
    const TenantService = require('../tenant/TenantService');
    res.json(TenantService.getPlans());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── CRM ───────────────────────────────────────────────────────────────────────
router.get('/api/v1/crm/stats', (req, res) => {
  try {
    const CRMService = require('../crm/CRMService');
    res.json(CRMService.getSegmentStats(tenantScope(req)));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/api/v1/crm/segment', (req, res) => {
  try {
    const CRMService = require('../crm/CRMService');
    const tags = (req.query.tags || '').split(',').map(t => t.trim()).filter(Boolean);
    const logic = req.query.logic === 'AND' ? 'AND' : 'OR';
    const limit = Math.min(parseInt(req.query.limit) || 200, 1000);
    const users = CRMService.getUsersBySegment(tags, logic, limit, tenantScope(req));
    res.json({ count: users.length, users, scope: tenantScope(req) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/api/v1/crm/user/:telegram_id', (req, res) => {
  try {
    const CRMService = require('../crm/CRMService');
    const history = CRMService.getCustomerHistory(req.params.telegram_id, tenantScope(req));
    if (!history) return res.status(404).json({ error: 'Usuário não encontrado neste escopo' });
    res.json(history);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/v1/crm/user/:telegram_id/tags', express.json(), (req, res) => {
  try {
    if (!rejectUnlessMutationScope(req, res)) return;
    const CRMService = require('../crm/CRMService');
    const { tag } = req.body;
    if (!tag) return res.status(400).json({ error: 'tag é obrigatório' });
    const scope = tenantScope(req);
    CRMService.addTag(req.params.telegram_id, tag, scope);
    res.json({ ok: true, tags: CRMService.getAllTags(req.params.telegram_id, scope) });
  } catch (e) {
    if (e.message?.includes('escopo')) return res.status(404).json({ error: e.message });
    res.status(500).json({ error: e.message });
  }
});

router.delete('/api/v1/crm/user/:telegram_id/tags/:tag', (req, res) => {
  try {
    if (!rejectUnlessMutationScope(req, res)) return;
    const CRMService = require('../crm/CRMService');
    const scope = tenantScope(req);
    CRMService.removeTag(req.params.telegram_id, req.params.tag, scope);
    res.json({ ok: true });
  } catch (e) {
    if (e.message?.includes('escopo')) return res.status(404).json({ error: e.message });
    res.status(500).json({ error: e.message });
  }
});

// ── HTML PAGES ────────────────────────────────────────────────────────────────

function loginPage(extra = '') {
  const port = parseInt(process.env.PORT || '3000', 10);
  const accessHint = formatAdminAccessHtml(port);
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Entrar · Hanork Necropolis</title>
<link rel="icon"
  href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Cpath fill='%23020104' d='M0 0h32v32H0z'/%3E%3Cpath fill='none' stroke='%23a855f7' stroke-width='1.2' d='M16 6c-4 0-7 3-7 7 0 2.5 1 4.5 2 5.5l-.5 4 2.5-1 1.5 4 1.5-1.5h3l1.5 1.5 1.5-4 2.5 1-.5-4c1-1 2-3 2-5.5 0-4-3-7-7-7z'/%3E%3Cellipse cx='13' cy='12' rx='1.5' ry='2' fill='%230a0612' stroke='%239333ea'/%3E%3Cellipse cx='19' cy='12' rx='1.5' ry='2' fill='%230a0612' stroke='%239333ea'/%3E%3C/svg%3E" />
<link rel="stylesheet" href="/css/admin-login-nebula.css?v=6" />
<link rel="stylesheet" href="/css/admin-gothic-glyphs.css?v=1" />
<style>
.access-hint{margin-top:10px;font-size:.75rem;color:rgba(255,255,255,.55);text-align:center;line-height:1.6}
.access-hint a{color:#a78bfa;text-decoration:none;font-family:monospace}
.access-lbl{color:rgba(255,255,255,.4);margin-right:6px;font-family:sans-serif}
.access-muted{font-style:italic}
.login-card{position:relative}
</style>
</head>
<body class="login-nebula">
<div class="app-bg" aria-hidden="true"></div>
<div class="gothic-veil" aria-hidden="true">
  <svg class="gv gv-skull-tr" viewBox="0 0 64 64"><use href="/assets/necropolis-glyphs.svg#glyph-skull"/></svg>
  <svg class="gv gv-blades-bl" viewBox="0 0 64 64"><use href="/assets/necropolis-glyphs.svg#glyph-blades"/></svg>
  <svg class="gv gv-chain-br" viewBox="0 0 64 64"><use href="/assets/necropolis-glyphs.svg#glyph-chain"/></svg>
  <svg class="gv gv-crown-tl" viewBox="0 0 64 64"><use href="/assets/necropolis-glyphs.svg#glyph-crown"/></svg>
</div>
<div class="login-card">
  <svg class="login-corner login-corner-tl" viewBox="0 0 64 64" aria-hidden="true"><use href="/assets/necropolis-glyphs.svg#glyph-corner"/></svg>
  <svg class="login-corner login-corner-br" viewBox="0 0 64 64" aria-hidden="true"><use href="/assets/necropolis-glyphs.svg#glyph-corner"/></svg>
  <div class="login-glyphs" aria-hidden="true">
    <svg viewBox="0 0 64 64"><use href="/assets/necropolis-glyphs.svg#glyph-skull"/></svg>
    <svg viewBox="0 0 64 64"><use href="/assets/necropolis-glyphs.svg#glyph-blades"/></svg>
    <svg viewBox="0 0 64 64"><use href="/assets/necropolis-glyphs.svg#glyph-chain"/></svg>
    <svg viewBox="0 0 64 64"><use href="/assets/necropolis-glyphs.svg#glyph-crown"/></svg>
  </div>
  <h1>Hanork</h1>
  <p class="sub">Necropolis · painel administrativo</p>
  ${extra}
  <form method="POST" action="/admin/login">
    <label>Usuário</label>
    <input type="text" name="username" placeholder="admin" required autocomplete="username">
    <label>Senha</label>
    <input type="password" name="password" placeholder="••••••••" required autocomplete="current-password">
    <button type="submit">Entrar</button>
  </form>
  <div class="access-links">${accessHint}</div>
</div>
</body>
</html>`;
}

function dashboardPage() {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Hanork Admin</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#0f0f1a;--surface:#1a1a2e;--border:rgba(255,255,255,.08);--text:#e0e0f0;--muted:rgba(255,255,255,.45);--primary:#7c6af7;--green:#4ade80;--red:#f87171;--yellow:#fbbf24;--blue:#60a5fa}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:var(--text);min-height:100vh}
/* Layout */
.layout{display:flex;min-height:100vh}
nav{width:220px;background:var(--surface);border-right:1px solid var(--border);display:flex;flex-direction:column;padding:20px 0;flex-shrink:0;position:sticky;top:0;height:100vh}
nav .logo{padding:0 20px 24px;font-size:1.2rem;font-weight:700;color:#fff;border-bottom:1px solid var(--border)}
nav .logo span{color:var(--primary)}
nav a{display:flex;align-items:center;gap:10px;padding:11px 20px;color:var(--muted);text-decoration:none;font-size:.9rem;transition:.15s;cursor:pointer}
nav a:hover,nav a.active{color:#fff;background:rgba(124,106,247,.15);border-right:2px solid var(--primary)}
nav .spacer{flex:1}
nav .logout{color:var(--red)!important}
main{flex:1;padding:28px;overflow-y:auto}
/* Header */
.page-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:24px}
.page-header h1{font-size:1.5rem;font-weight:700}
/* Cards */
.stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:28px}
.stat-card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:20px}
.stat-card .label{color:var(--muted);font-size:.8rem;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px}
.stat-card .value{font-size:1.8rem;font-weight:700;color:#fff}
.stat-card .sub{color:var(--muted);font-size:.78rem;margin-top:4px}
.stat-card.green .value{color:var(--green)}
.stat-card.blue .value{color:var(--blue)}
.stat-card.yellow .value{color:var(--yellow)}
/* Charts */
.charts-grid{display:grid;grid-template-columns:2fr 1fr;gap:16px;margin-bottom:28px}
.chart-card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:20px}
.chart-card h3{font-size:.95rem;color:var(--muted);margin-bottom:16px;text-transform:uppercase;letter-spacing:.5px}
.chart-wrap{position:relative;height:220px}
/* Tables */
.table-card{background:var(--surface);border:1px solid var(--border);border-radius:14px;overflow:hidden;margin-bottom:24px}
.table-header{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border)}
.table-header h3{font-size:.95rem;font-weight:600}
table{width:100%;border-collapse:collapse}
th{padding:10px 16px;text-align:left;color:var(--muted);font-size:.78rem;text-transform:uppercase;letter-spacing:.4px;font-weight:600;border-bottom:1px solid var(--border)}
td{padding:12px 16px;font-size:.88rem;border-bottom:1px solid rgba(255,255,255,.04)}
tr:last-child td{border-bottom:none}
tr:hover td{background:rgba(255,255,255,.02)}
.badge{display:inline-block;padding:2px 10px;border-radius:20px;font-size:.75rem;font-weight:600}
.badge.paid{background:rgba(74,222,128,.15);color:var(--green)}
.badge.pending{background:rgba(251,191,36,.15);color:var(--yellow)}
.badge.failed{background:rgba(248,113,113,.15);color:var(--red)}
.badge.created{background:rgba(96,165,250,.15);color:var(--blue)}
/* Sections */
.section{display:none}.section.active{display:block}
/* Forms */
.form-card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:24px;max-width:600px;margin-bottom:24px}
.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.form-group{display:flex;flex-direction:column;gap:6px;margin-bottom:4px}
.form-group.full{grid-column:1/-1}
label{font-size:.82rem;color:var(--muted)}
input,select,textarea{background:rgba(255,255,255,.06);border:1px solid var(--border);border-radius:8px;color:#fff;padding:9px 12px;font-size:.9rem;outline:none;transition:.15s;width:100%}
input:focus,select:focus,textarea:focus{border-color:var(--primary)}
select option{background:var(--surface)}
.btn{padding:9px 18px;border:none;border-radius:8px;cursor:pointer;font-size:.88rem;font-weight:600;transition:.15s}
.btn-primary{background:var(--primary);color:#fff}.btn-primary:hover{opacity:.85}
.btn-danger{background:var(--red);color:#fff}.btn-danger:hover{opacity:.85}
.btn-sm{padding:5px 12px;font-size:.78rem}
.search-bar{display:flex;gap:10px;margin-bottom:16px}
.search-bar input{max-width:280px}
.pagination{display:flex;gap:8px;align-items:center;justify-content:flex-end;padding:12px 0}
.pagination button{background:var(--surface);border:1px solid var(--border);color:var(--text);padding:6px 14px;border-radius:8px;cursor:pointer;font-size:.82rem}
.pagination button.active,.pagination button:hover{background:var(--primary);border-color:var(--primary);color:#fff}
/* Modal */
.modal-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:100;align-items:center;justify-content:center}
.modal-overlay.open{display:flex}
.modal{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:28px;width:90%;max-width:500px;position:relative}
.modal h3{margin-bottom:20px;font-size:1.1rem}
.modal-close{position:absolute;top:16px;right:16px;background:none;border:none;color:var(--muted);font-size:1.3rem;cursor:pointer}
/* Alerts */
.alert{padding:10px 14px;border-radius:8px;font-size:.85rem;margin-bottom:12px}
.alert.success{background:rgba(74,222,128,.1);border:1px solid rgba(74,222,128,.2);color:var(--green)}
.alert.error{background:rgba(248,113,113,.1);border:1px solid rgba(248,113,113,.2);color:var(--red)}
@media(max-width:768px){nav{display:none}.charts-grid{grid-template-columns:1fr}.form-grid{grid-template-columns:1fr}}
</style>
</head>
<body>
<div class="layout">
<!-- Sidebar -->
<nav id="nav">
  <div class="logo">⚡ <span>Hanork</span></div>
  <a onclick="showSection('overview')" class="active" id="nav-overview">📊 Visão Geral</a>
  <a onclick="showSection('orders')" id="nav-orders">📋 Pedidos</a>
  <a onclick="showSection('products')" id="nav-products">🛍️ Produtos</a>
  <a onclick="showSection('users')" id="nav-users">👥 Usuários</a>
  <a onclick="showSection('coupons')" id="nav-coupons">🏷️ Cupons</a>
  <a onclick="showSection('groups')" id="nav-groups">🌐 Grupos</a>
  <a onclick="showSection('analytics')" id="nav-analytics">📈 Analytics</a>
  <a onclick="showSection('tenants')" id="nav-tenants">🏪 Lojistas</a>
  <div class="spacer"></div>
  <a class="logout" onclick="logout()">🚪 Sair</a>
</nav>
<!-- Main -->
<main>

<!-- OVERVIEW -->
<div class="section active" id="sec-overview">
  <div class="page-header"><h1>Visão Geral</h1><span id="last-updated" style="color:var(--muted);font-size:.82rem"></span></div>
  <div class="stats-grid">
    <div class="stat-card green"><div class="label">Receita Hoje</div><div class="value" id="rev-today">—</div><div class="sub">receitas confirmadas</div></div>
    <div class="stat-card green"><div class="label">Receita Semana</div><div class="value" id="rev-week">—</div></div>
    <div class="stat-card green"><div class="label">Receita Mês</div><div class="value" id="rev-month">—</div></div>
    <div class="stat-card blue"><div class="label">Usuários</div><div class="value" id="cnt-users">—</div></div>
    <div class="stat-card blue"><div class="label">Pedidos Pagos</div><div class="value" id="cnt-orders">—</div></div>
    <div class="stat-card yellow"><div class="label">Aguardando Pgto</div><div class="value" id="cnt-pending">—</div></div>
    <div class="stat-card"><div class="label">Ticket Médio/Mês</div><div class="value" id="avg-ticket">—</div></div>
    <div class="stat-card"><div class="label">Grupos</div><div class="value" id="cnt-groups">—</div></div>
  </div>
  <div class="charts-grid">
    <div class="chart-card"><h3>Vendas — últimos 30 dias</h3><div class="chart-wrap"><canvas id="salesChart"></canvas></div></div>
    <div class="chart-card"><h3>Funil de Conversão</h3><div class="chart-wrap"><canvas id="funnelChart"></canvas></div></div>
  </div>
</div>

<!-- ORDERS -->
<div class="section" id="sec-orders">
  <div class="page-header"><h1>Pedidos</h1></div>
  <div class="search-bar">
    <select id="order-status-filter" onchange="loadOrders(1)">
      <option value="">Todos os status</option>
      <option value="PAID">Pago</option>
      <option value="WAITING_PAYMENT">Aguardando</option>
      <option value="DELIVERED">Entregue</option>
      <option value="CREATED">Criado</option>
      <option value="FAILED">Falhou</option>
    </select>
  </div>
  <div class="table-card">
    <div class="table-header"><h3>Lista de Pedidos</h3><span id="orders-total" style="color:var(--muted);font-size:.82rem"></span></div>
    <table><thead><tr><th>ID</th><th>Usuário</th><th>Total</th><th>Status</th><th>Método</th><th>Data</th></tr></thead>
    <tbody id="orders-tbody"></tbody></table>
    <div class="pagination" id="orders-pagination"></div>
  </div>
</div>

<!-- PRODUCTS -->
<div class="section" id="sec-products">
  <div class="page-header"><h1>Produtos</h1><button class="btn btn-primary" onclick="openModal('product-modal')">+ Novo Produto</button></div>
  <div class="search-bar"><input type="text" id="product-search" placeholder="Buscar produto..." oninput="debounce(()=>loadProducts(1),400)"></div>
  <div class="table-card">
    <div class="table-header"><h3>Catálogo</h3><span id="products-total" style="color:var(--muted);font-size:.82rem"></span></div>
    <table><thead><tr><th>ID</th><th>Nome</th><th>Preço</th><th>Formato</th><th>Estoque</th><th>Status</th><th>Ações</th></tr></thead>
    <tbody id="products-tbody"></tbody></table>
    <div class="pagination" id="products-pagination"></div>
  </div>
</div>

<!-- USERS -->
<div class="section" id="sec-users">
  <div class="page-header"><h1>Usuários</h1></div>
  <div class="search-bar"><input type="text" id="user-search" placeholder="Buscar por username ou ID..." oninput="debounce(()=>loadUsers(1),400)"></div>
  <div class="table-card">
    <div class="table-header"><h3>Usuários cadastrados</h3><span id="users-total" style="color:var(--muted);font-size:.82rem"></span></div>
    <table><thead><tr><th>ID TG</th><th>Nome</th><th>Username</th><th>Pedidos</th><th>Total gasto</th><th>Cadastro</th></tr></thead>
    <tbody id="users-tbody"></tbody></table>
    <div class="pagination" id="users-pagination"></div>
  </div>
</div>

<!-- COUPONS -->
<div class="section" id="sec-coupons">
  <div class="page-header"><h1>Cupons</h1><button class="btn btn-primary" onclick="openModal('coupon-modal')">+ Novo Cupom</button></div>
  <div class="table-card">
    <div class="table-header"><h3>Cupons ativos</h3></div>
    <table><thead><tr><th>Código</th><th>Tipo</th><th>Valor</th><th>Usos</th><th>Mín.</th><th>Status</th><th>Ações</th></tr></thead>
    <tbody id="coupons-tbody"></tbody></table>
  </div>
</div>

<!-- GROUPS -->
<div class="section" id="sec-groups">
  <div class="page-header"><h1>Grupos</h1></div>
  <div class="table-card">
    <div class="table-header"><h3>Grupos onde o bot está</h3></div>
    <table><thead><tr><th>Chat ID</th><th>Nome</th><th>Tipo</th><th>Membros</th><th>Admin?</th><th>Atualizado</th></tr></thead>
    <tbody id="groups-tbody"></tbody></table>
  </div>
</div>

<!-- TENANTS -->
<div class="section" id="sec-tenants">
  <div class="page-header"><h1>Lojistas</h1></div>
  <div class="stats-grid" id="tenants-stats" style="margin-bottom:20px"></div>
  <div class="table-card">
    <div class="table-header"><h3>Lojistas cadastrados</h3><span id="tenants-total" style="color:var(--muted);font-size:.82rem"></span></div>
    <table><thead><tr><th>ID</th><th>Nome</th><th>Slug</th><th>Dono (TG)</th><th>Plano</th><th>Status</th><th>Criado</th><th>Ações</th></tr></thead>
    <tbody id="tenants-tbody"></tbody></table>
    <div class="pagination" id="tenants-pagination"></div>
  </div>
</div>

<!-- ANALYTICS -->
<div class="section" id="sec-analytics">
  <div class="page-header"><h1>Analytics</h1>
    <select id="analytics-days" onchange="loadAnalytics()">
      <option value="7">7 dias</option>
      <option value="30" selected>30 dias</option>
      <option value="60">60 dias</option>
      <option value="90">90 dias</option>
    </select>
  </div>
  <div class="charts-grid" style="grid-template-columns:1fr">
    <div class="chart-card"><h3>Receita por dia</h3><div class="chart-wrap" style="height:300px"><canvas id="analyticsChart"></canvas></div></div>
  </div>
  <div class="charts-grid">
    <div class="chart-card"><h3>Funil de conversão</h3><div class="chart-wrap"><canvas id="funnelBigChart"></canvas></div></div>
  </div>
</div>

</main>
</div>

<!-- MODAL: Produto -->
<div class="modal-overlay" id="product-modal">
<div class="modal">
  <button class="modal-close" onclick="closeModal('product-modal')">✕</button>
  <h3 id="product-modal-title">Novo Produto</h3>
  <div id="product-alert"></div>
  <input type="hidden" id="product-id">
  <div class="form-grid">
    <div class="form-group full"><label>Nome *</label><input id="p-name" placeholder="Nome do produto"></div>
    <div class="form-group"><label>Preço (R$) *</label><input id="p-price" type="number" step="0.01" placeholder="19.90"></div>
    <div class="form-group"><label>Formato</label><input id="p-category" placeholder="automático (mp4, jpg, zip, pdf…)"></div>
    <div class="form-group"><label>Estoque</label><input id="p-stock" type="number" placeholder="999"></div>
    <div class="form-group full"><label>Descrição</label><textarea id="p-desc" rows="3" placeholder="Descrição do produto..."></textarea></div>
    <div class="form-group full"><label>URL do arquivo (entrega digital)</label><input id="p-file" placeholder="https://..."></div>
    <div class="form-group full"><label>URL da foto</label><input id="p-photo" placeholder="https://..."></div>
  </div>
  <div style="margin-top:16px;display:flex;gap:8px">
    <button class="btn btn-primary" onclick="saveProduct()">Salvar</button>
    <button class="btn" onclick="closeModal('product-modal')" style="background:var(--border)">Cancelar</button>
  </div>
</div>
</div>

<!-- MODAL: Cupom -->
<div class="modal-overlay" id="coupon-modal">
<div class="modal">
  <button class="modal-close" onclick="closeModal('coupon-modal')">✕</button>
  <h3>Novo Cupom</h3>
  <div id="coupon-alert"></div>
  <div class="form-grid">
    <div class="form-group"><label>Código *</label><input id="c-code" placeholder="PROMO10"></div>
    <div class="form-group"><label>Tipo</label>
      <select id="c-type"><option value="percent">Percentual (%)</option><option value="fixed">Fixo (R$)</option></select>
    </div>
    <div class="form-group"><label>Valor *</label><input id="c-value" type="number" step="0.01" placeholder="10"></div>
    <div class="form-group"><label>Máx. usos</label><input id="c-maxuses" type="number" placeholder="100"></div>
    <div class="form-group"><label>Mínimo carrinho (R$)</label><input id="c-mintotal" type="number" step="0.01" placeholder="0"></div>
    <div class="form-group"><label>Expira em</label><input id="c-expires" type="date"></div>
  </div>
  <div style="margin-top:16px;display:flex;gap:8px">
    <button class="btn btn-primary" onclick="saveCoupon()">Criar Cupom</button>
    <button class="btn" onclick="closeModal('coupon-modal')" style="background:var(--border)">Cancelar</button>
  </div>
</div>
</div>

<script>
// ── State ────────────────────────────────────────────────────────────────────
let salesChart, funnelChart, analyticsChart, funnelBigChart;
let debounceTimer;
function debounce(fn, ms) { clearTimeout(debounceTimer); debounceTimer = setTimeout(fn, ms); }

// ── Navigation ───────────────────────────────────────────────────────────────
function showSection(id) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('nav a').forEach(a => a.classList.remove('active'));
  document.getElementById('sec-'+id).classList.add('active');
  document.getElementById('nav-'+id).classList.add('active');
  const loaders = { overview: loadOverview, orders: ()=>loadOrders(1), products: ()=>loadProducts(1), users: ()=>loadUsers(1), coupons: loadCoupons, groups: loadGroups, analytics: loadAnalytics, tenants: ()=>loadTenants(1) };
  loaders[id]?.();
}

// ── API Fetch ─────────────────────────────────────────────────────────────────
async function api(path, opts = {}) {
  const res = await fetch(path, { credentials: 'include', ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers||{}) } });
  if (res.status === 401) { location.href = '/admin/login'; return null; }
  return res.json();
}

function fmt(n) { return 'R$ ' + Number(n||0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtDate(d) { return d ? new Date(d).toLocaleDateString('pt-BR') : '—'; }
function statusBadge(s) {
  const m = { PAID:'paid', WAITING_PAYMENT:'pending', DELIVERED:'paid', FAILED:'failed', CREATED:'created' };
  const l = { PAID:'Pago', WAITING_PAYMENT:'Aguardando', DELIVERED:'Entregue', FAILED:'Falhou', CREATED:'Criado' };
  return \`<span class="badge \${m[s]||''}">\${l[s]||s}</span>\`;
}

// ── Modals ───────────────────────────────────────────────────────────────────
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// ── OVERVIEW ─────────────────────────────────────────────────────────────────
async function loadOverview() {
  const [stats, sales, funnel] = await Promise.all([
    api('/api/v1/stats'), api('/api/v1/analytics/sales?days=30'), api('/api/v1/analytics/funnel?days=30')
  ]);
  if (!stats) return;
  document.getElementById('rev-today').textContent = fmt(stats.revenue.today);
  document.getElementById('rev-week').textContent = fmt(stats.revenue.week);
  document.getElementById('rev-month').textContent = fmt(stats.revenue.month);
  document.getElementById('cnt-users').textContent = stats.counts.users.toLocaleString();
  document.getElementById('cnt-orders').textContent = stats.counts.orders_paid.toLocaleString();
  document.getElementById('cnt-pending').textContent = stats.counts.orders_pending;
  document.getElementById('avg-ticket').textContent = fmt(stats.avgTicket);
  document.getElementById('cnt-groups').textContent = stats.counts.groups;
  document.getElementById('last-updated').textContent = 'Atualizado: ' + new Date().toLocaleTimeString('pt-BR');

  if (sales) {
    const labels = sales.map(d => d.date);
    const data = sales.map(d => d.revenue);
    if (salesChart) salesChart.destroy();
    salesChart = new Chart(document.getElementById('salesChart'), {
      type: 'line',
      data: { labels, datasets: [{ label: 'Receita', data, borderColor: '#7c6af7', backgroundColor: 'rgba(124,106,247,.1)', fill: true, tension: .4 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#888', maxTicksLimit: 7 }, grid: { color: 'rgba(255,255,255,.04)' } }, y: { ticks: { color: '#888', callback: v => 'R$'+v.toFixed(0) }, grid: { color: 'rgba(255,255,255,.04)' } } } }
    });
  }
  if (funnel) {
    if (funnelChart) funnelChart.destroy();
    funnelChart = new Chart(document.getElementById('funnelChart'), {
      type: 'bar',
      data: { labels: funnel.map(f => f.stage), datasets: [{ data: funnel.map(f => f.count), backgroundColor: ['#7c6af7','#4ade80','#fbbf24'] }] },
      options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#888' }, grid: { color: 'rgba(255,255,255,.04)' } }, y: { ticks: { color: '#aaa' } } } }
    });
  }
}

// ── ORDERS ────────────────────────────────────────────────────────────────────
async function loadOrders(page = 1) {
  const status = document.getElementById('order-status-filter').value;
  const url = \`/api/v1/orders?page=\${page}&limit=20\${status ? '&status=' + status : ''}\`;
  const data = await api(url);
  if (!data) return;
  document.getElementById('orders-total').textContent = \`\${data.total} pedidos\`;
  const tbody = document.getElementById('orders-tbody');
  tbody.innerHTML = data.orders.map(o => \`<tr>
    <td><code style="color:var(--primary)">#\${o.id.slice(-8)}</code></td>
    <td>\${o.first_name || ''} \${o.username ? '@'+o.username : o.user_id}</td>
    <td>\${fmt(o.total)}</td>
    <td>\${statusBadge(o.status)}</td>
    <td>\${o.payment_method||'—'}</td>
    <td>\${fmtDate(o.created_at)}</td>
  </tr>\`).join('');
  renderPagination('orders-pagination', data.page, data.pages, loadOrders);
}

// ── PRODUCTS ──────────────────────────────────────────────────────────────────
async function loadProducts(page = 1) {
  const q = document.getElementById('product-search')?.value || '';
  const data = await api(\`/api/v1/products?page=\${page}&limit=20&q=\${encodeURIComponent(q)}\`);
  if (!data) return;
  document.getElementById('products-total').textContent = \`\${data.total} produtos\`;
  const tbody = document.getElementById('products-tbody');
  tbody.innerHTML = data.products.map(p => \`<tr>
    <td><code>\${p.id}</code></td>
    <td>\${p.name}</td>
    <td>\${fmt(p.price)}</td>
    <td><span style="color:var(--muted)">\${p.format || '—'}</span></td>
    <td>\${p.stock >= 999 ? '∞' : p.stock}</td>
    <td>\${p.active ? '<span class="badge paid">Ativo</span>' : '<span class="badge failed">Inativo</span>'}</td>
    <td>
      <button class="btn btn-sm btn-primary" onclick="editProduct(\${JSON.stringify(p).replace(/"/g,'&quot;')})">✏️</button>
      <button class="btn btn-sm btn-danger" onclick="deleteProduct(\${p.id})">🗑️</button>
    </td>
  </tr>\`).join('');
  renderPagination('products-pagination', data.page, data.pages, loadProducts);
}

function editProduct(p) {
  document.getElementById('product-modal-title').textContent = 'Editar Produto';
  document.getElementById('product-id').value = p.id;
  document.getElementById('p-name').value = p.name;
  document.getElementById('p-price').value = p.price;
  document.getElementById('p-category').value = (p.format || p.category || '').toLowerCase();
  document.getElementById('p-stock').value = p.stock || 999;
  document.getElementById('p-desc').value = p.description || '';
  document.getElementById('p-file').value = p.file_url || '';
  document.getElementById('p-photo').value = p.photo_url || '';
  openModal('product-modal');
}

async function saveProduct() {
  const id = document.getElementById('product-id').value;
  const body = {
    name: document.getElementById('p-name').value,
    price: document.getElementById('p-price').value,
    category: (document.getElementById('p-category').value || '').trim().toLowerCase(),
    stock: document.getElementById('p-stock').value || 999,
    description: document.getElementById('p-desc').value,
    file_url: document.getElementById('p-file').value,
    photo_url: document.getElementById('p-photo').value,
  };
  const method = id ? 'PUT' : 'POST';
  const url = id ? \`/api/v1/products/\${id}\` : '/api/v1/products';
  const res = await api(url, { method, body: JSON.stringify(body) });
  if (res?.ok || res?.id) {
    showAlert('product-alert', 'Produto salvo com sucesso!', 'success');
    setTimeout(() => { closeModal('product-modal'); loadProducts(1); document.getElementById('product-id').value = ''; }, 800);
  } else {
    showAlert('product-alert', res?.error || 'Erro ao salvar', 'error');
  }
}

async function deleteProduct(id) {
  if (!confirm('Desativar este produto?')) return;
  await api(\`/api/v1/products/\${id}\`, { method: 'DELETE' });
  loadProducts(1);
}

// ── USERS ─────────────────────────────────────────────────────────────────────
async function loadUsers(page = 1) {
  const q = document.getElementById('user-search')?.value || '';
  const data = await api(\`/api/v1/users?page=\${page}&limit=20&q=\${encodeURIComponent(q)}\`);
  if (!data) return;
  document.getElementById('users-total').textContent = \`\${data.total} usuários\`;
  const tbody = document.getElementById('users-tbody');
  tbody.innerHTML = data.users.map(u => \`<tr>
    <td><code>\${u.telegram_id}</code></td>
    <td>\${u.first_name||''} \${u.last_name||''}</td>
    <td>\${u.username ? '@'+u.username : '—'}</td>
    <td>\${u.orders_count}</td>
    <td>\${fmt(u.total_spent)}</td>
    <td>\${fmtDate(u.created_at)}</td>
  </tr>\`).join('');
  renderPagination('users-pagination', data.page, data.pages, loadUsers);
}

// ── COUPONS ───────────────────────────────────────────────────────────────────
async function loadCoupons() {
  const data = await api('/api/v1/coupons');
  if (!data) return;
  const tbody = document.getElementById('coupons-tbody');
  tbody.innerHTML = data.map(c => \`<tr>
    <td><code style="color:var(--primary)">\${c.code}</code></td>
    <td>\${c.type === 'percent' ? '%' : 'R$'}</td>
    <td>\${c.type === 'percent' ? c.value+'%' : fmt(c.value)}</td>
    <td>\${c.used}/\${c.max_uses}</td>
    <td>\${c.min_total > 0 ? fmt(c.min_total) : '—'}</td>
    <td>\${c.active ? '<span class="badge paid">Ativo</span>' : '<span class="badge failed">Inativo</span>'}</td>
    <td>
      <button class="btn btn-sm" onclick="toggleCoupon(\${c.id},\${c.active})" style="background:var(--border)">\${c.active?'Desativar':'Ativar'}</button>
      <button class="btn btn-sm btn-danger" onclick="deleteCoupon(\${c.id})">🗑️</button>
    </td>
  </tr>\`).join('');
}

async function saveCoupon() {
  const body = {
    code: document.getElementById('c-code').value.toUpperCase(),
    type: document.getElementById('c-type').value,
    value: document.getElementById('c-value').value,
    max_uses: document.getElementById('c-maxuses').value || 100,
    min_total: document.getElementById('c-mintotal').value || 0,
    expires_at: document.getElementById('c-expires').value || null,
  };
  const res = await api('/api/v1/coupons', { method: 'POST', body: JSON.stringify(body) });
  if (res?.ok) { showAlert('coupon-alert','Cupom criado!','success'); setTimeout(()=>{ closeModal('coupon-modal'); loadCoupons(); }, 800); }
  else showAlert('coupon-alert', res?.error||'Erro','error');
}

async function toggleCoupon(id, active) { await api(\`/api/v1/coupons/\${id}\`, { method:'PUT', body: JSON.stringify({ active: !active }) }); loadCoupons(); }
async function deleteCoupon(id) { if (!confirm('Remover cupom?')) return; await api(\`/api/v1/coupons/\${id}\`, { method:'DELETE' }); loadCoupons(); }

// ── GROUPS ────────────────────────────────────────────────────────────────────
async function loadGroups() {
  const data = await api('/api/v1/groups');
  if (!data) return;
  const tbody = document.getElementById('groups-tbody');
  tbody.innerHTML = data.map(g => \`<tr>
    <td><code>\${g.chat_id}</code></td>
    <td>\${g.title}</td>
    <td>\${g.type}</td>
    <td>\${g.member_count}</td>
    <td>\${g.bot_is_admin ? '✅ Admin' : '👤 Membro'}</td>
    <td>\${fmtDate(g.updated_at)}</td>
  </tr>\`).join('');
}

// ── ANALYTICS ────────────────────────────────────────────────────────────────
async function loadAnalytics() {
  const days = document.getElementById('analytics-days')?.value || 30;
  const [sales, funnel] = await Promise.all([
    api(\`/api/v1/analytics/sales?days=\${days}\`),
    api(\`/api/v1/analytics/funnel?days=\${days}\`)
  ]);
  if (sales) {
    if (analyticsChart) analyticsChart.destroy();
    analyticsChart = new Chart(document.getElementById('analyticsChart'), {
      type: 'bar',
      data: { labels: sales.map(d=>d.date), datasets: [
        { label:'Receita', data: sales.map(d=>d.revenue), backgroundColor:'rgba(124,106,247,.7)', yAxisID:'y' },
        { label:'Pedidos', data: sales.map(d=>d.orders), backgroundColor:'rgba(74,222,128,.5)', type:'line', yAxisID:'y1', tension:.4 }
      ]},
      options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ labels:{ color:'#aaa' } } }, scales:{ x:{ ticks:{ color:'#888', maxTicksLimit:10 }, grid:{ color:'rgba(255,255,255,.04)' } }, y:{ ticks:{ color:'#888', callback:v=>'R$'+v.toFixed(0) }, grid:{ color:'rgba(255,255,255,.04)' } }, y1:{ position:'right', ticks:{ color:'#4ade80' }, grid:{ display:false } } } }
    });
  }
  if (funnel) {
    if (funnelBigChart) funnelBigChart.destroy();
    funnelBigChart = new Chart(document.getElementById('funnelBigChart'), {
      type: 'bar',
      data: { labels: funnel.map(f=>f.stage), datasets: [{ data: funnel.map(f=>f.count), backgroundColor:['rgba(124,106,247,.8)','rgba(96,165,250,.8)','rgba(74,222,128,.8)'] }] },
      options: { responsive:true, maintainAspectRatio:false, indexAxis:'y', plugins:{ legend:{ display:false } }, scales:{ x:{ ticks:{ color:'#888' }, grid:{ color:'rgba(255,255,255,.04)' } }, y:{ ticks:{ color:'#aaa' } } } }
    });
  }
}

// ── TENANTS ───────────────────────────────────────────────────────────────────
async function loadTenants(page = 1) {
  const [data, plans] = await Promise.all([api(\`/api/v1/tenants?page=\${page}&limit=20\`), api('/api/v1/plans')]);
  if (!data) return;
  const planMap = Object.fromEntries((plans||[]).map(p => [p.name, p]));
  document.getElementById('tenants-total').textContent = \`\${data.total} lojistas\`;
  const tbody = document.getElementById('tenants-tbody');
  tbody.innerHTML = data.rows.map(t => {
    const p = planMap[t.plan] || {};
    return \`<tr>
      <td><code>\${t.id}</code></td>
      <td><b>\${t.name}</b></td>
      <td><code>\${t.slug}</code></td>
      <td><code>\${t.owner_telegram_id}</code></td>
      <td><span class="badge \${t.plan==='free'?'created':t.plan==='pro'?'paid':'pending'}">\${p.label||t.plan}</span></td>
      <td>\${t.active ? '<span class="badge paid">Ativo</span>' : '<span class="badge failed">Inativo</span>'}</td>
      <td>\${fmtDate(t.created_at)}</td>
      <td>
        <select onchange="changeTenantPlan(\${t.id},this.value)" style="background:var(--surface);border:1px solid var(--border);color:#fff;border-radius:6px;padding:4px 8px;font-size:.78rem">
          \${(plans||[]).map(p => \`<option value="\${p.name}" \${p.name===t.plan?'selected':''}>\${p.label}</option>\`).join('')}
        </select>
        <button class="btn btn-sm btn-danger" onclick="deleteTenant(\${t.id})" style="margin-left:4px">🗑️</button>
      </td>
    </tr>\`;
  }).join('');
  renderPagination('tenants-pagination', data.page, data.pages, loadTenants);
}
async function changeTenantPlan(id, plan) {
  await api(\`/api/v1/tenants/\${id}\`, { method:'PUT', body: JSON.stringify({ plan }) });
  loadTenants(1);
}
async function deleteTenant(id) {
  if (!confirm('Desativar este lojista?')) return;
  await api(\`/api/v1/tenants/\${id}\`, { method:'DELETE' });
  loadTenants(1);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function showAlert(elId, msg, type) {
  const el = document.getElementById(elId);
  el.innerHTML = \`<div class="alert \${type}">\${msg}</div>\`;
  setTimeout(() => el.innerHTML = '', 4000);
}

function renderPagination(elId, current, total, loadFn) {
  const el = document.getElementById(elId);
  if (total <= 1) { el.innerHTML = ''; return; }
  let html = '';
  for (let i = 1; i <= Math.min(total, 10); i++) {
    html += \`<button class="\${i===current?'active':''}" onclick="\${loadFn.name}(\${i})">\${i}</button>\`;
  }
  el.innerHTML = html;
}

async function logout() { await fetch('/admin/logout', { method:'POST', credentials:'include' }); location.href='/admin/login'; }

// ── Init ──────────────────────────────────────────────────────────────────────
loadOverview();
setInterval(loadOverview, 60000);
</script>
</body>
</html>`;
}

module.exports = router;
