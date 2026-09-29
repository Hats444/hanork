'use strict';

/**
 * Endpoints REST para o painel Flutter (Hanork Panel).
 * Apenas leitura + auth — automação permanece no servidor.
 */
const express = require('express');
const AuthService = require('./AuthService');
const { requireAuth, extractToken } = require('./authMiddleware');
const { attachDashboardTenant } = require('./dashboardTenantMiddleware');
const logger = require('../../config/logger');

function dashboardCredentials() {
  return {
    user: process.env.DASHBOARD_USER || 'admin',
    passHash: process.env.DASHBOARD_PASS_HASH || '',
    passPlain: process.env.DASHBOARD_PASS || '',
    isProd: process.env.NODE_ENV === 'production',
  };
}

async function verifyDashboardPassword(username, password) {
  const { user, passHash, passPlain, isProd } = dashboardCredentials();
  if (username !== user) return false;
  if (passHash) return AuthService.verifyPassword(password, passHash);
  if (passPlain) {
    if (isProd) return false;
    return password === passPlain;
  }
  return !isProd;
}

function registerMobileApi(router) {
  router.post('/api/v1/auth/login', express.json(), async (req, res) => {
    const ip =
      req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
      req.socket?.remoteAddress ||
      'unknown';
    const lim = AuthService.checkLoginAttempts(ip);
    if (!lim.allowed) {
      return res.status(429).json({ error: `Muitas tentativas. Aguarde ${lim.retryAfter}s.` });
    }

    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');

    if (!username || !password) {
      return res.status(400).json({ error: 'username e password são obrigatórios' });
    }

    const { passHash, passPlain, isProd } = dashboardCredentials();
    if (isProd && !passHash && !passPlain) {
      return res.status(503).json({ error: 'Painel desativado: configure DASHBOARD_PASS_HASH' });
    }

    const ok = await verifyDashboardPassword(username, password);
    if (!ok) {
      AuthService.recordFailedLogin(ip);
      logger.warn(`[AUTH mobile] Login falhou: user=${username} ip=${ip}`);
      return res.status(401).json({ error: 'Usuário ou senha incorretos' });
    }

    AuthService.recordSuccessLogin(ip);
    const token = AuthService.createSession({ id: username, role: 'admin' });
    logger.info(`[AUTH mobile] Login OK: user=${username} ip=${ip}`);

    res.json({
      ok: true,
      token,
      expiresIn: process.env.DASHBOARD_JWT_EXPIRES || '8h',
      user: { id: username, role: 'admin' },
    });
  });

  router.post('/api/v1/auth/logout', requireAuth, (req, res) => {
    const token = extractToken(req);
    if (token) AuthService.revokeSession(token);
    res.json({ ok: true });
  });

  router.get('/api/v1/auth/me', requireAuth, (req, res) => {
    res.json({ user: req.admin, ok: true });
  });

  router.get('/api/v1/mobile/home', requireAuth, attachDashboardTenant, async (req, res) => {
    try {
      const DashboardService = require('../dashboard/DashboardService');
      const OpsDashboardService = require('../dashboard/OpsDashboardService');

      let smmBalance = null;
      try {
        const { fetchProviderBalance, classifyBalance } = require('../smm/services/providerBalanceService');
        const snap = await fetchProviderBalance();
        if (snap?.ok) {
          const cls = classifyBalance(snap.balance);
          smmBalance = {
            balance: snap.balance,
            currency: snap.currency || 'BRL',
            level: cls.level,
            provider: snap.providerId || null,
          };
        }
      } catch {
        /* SMM opcional */
      }

      const [kpis, ops] = await Promise.all([
        Promise.resolve(DashboardService.getKPIs(req.tenantScope)),
        OpsDashboardService.getFullOpsSummary({ force: false }),
      ]);

      res.json({
        generatedAt: new Date().toISOString(),
        scope: req.tenantScope,
        kpis,
        ops,
        smmBalance,
        uptimeSec: Math.floor(process.uptime()),
      });
    } catch (e) {
      logger.error('[MOBILE API] home:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/api/v1/settings', requireAuth, (req, res) => {
    res.json({
      botUsername: process.env.BOT_USERNAME || null,
      zeroDivuEnabled: String(process.env.ZERO_DIVU_ENABLED || '0') === '1',
      waDualEnabled: String(process.env.WA_DUAL_ENABLED || '0') === '1',
      campaignOrchestrator: String(process.env.CAMPAIGN_ORCHESTRATOR || '0') === '1',
      statusMirrorToChat: String(process.env.STATUS_MIRROR_TO_CHAT || '0') === '1',
      smmEnabled: String(process.env.SMM_ENABLED || '1') !== '0',
      port: parseInt(process.env.PORT || '3000', 10),
      version: '3.0.0',
      nodeEnv: process.env.NODE_ENV || 'development',
    });
  });
}

module.exports = { registerMobileApi };
