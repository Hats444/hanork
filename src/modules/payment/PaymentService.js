/**
 * Module: Payment Service
 * Integração com Mercado Pago (PIX, Cartão, Boleto)
 * Idempotência e retry automático
 */
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const logger = require('../../config/logger');

function readMpToken() {
  const raw =
    process.env.TOKEN_MP ||
    process.env.MERCADO_PAGO_ACCESS_TOKEN ||
    process.env.MP_ACCESS_TOKEN ||
    '';
  return String(raw).trim().replace(/\r/g, '').replace(/^["']|["']$/g, '');
}

function resolveTokenForTenant(tenant) {
  const custom = tenant?.token_mp ? String(tenant.token_mp).trim() : '';
  if (tokenLooksValid(custom)) return custom;
  return readMpToken();
}

function tenantFromContext() {
  try {
    const tc = require('../../infrastructure/TenantContext').getCurrent();
    if (tc?.mode === 'tenant' && tc.id != null) return tc;
  } catch {
    /* ignore */
  }
  return null;
}

function tokenLooksValid(token) {
  return (
    !!token &&
    token.length > 10 &&
    token !== 'undefined' &&
    /^(APP_USR-|TEST-)/i.test(token)
  );
}

function isMpTestMode(token = readMpToken()) {
  return process.env.MP_SANDBOX === 'true' || /^TEST-/i.test(token);
}

function formatMpAmount(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n < 0.5) {
    throw Object.assign(new Error('Valor mínimo para pagamento: R$ 0,50'), { code: 'INVALID_AMOUNT' });
  }
  return Number(n.toFixed(2));
}

/** Mensagem legível a partir do erro da API MP */
function formatMpError(e) {
  const status = e.response?.status;
  const data = e.response?.data;
  const parts = [];
  if (status) parts.push(`HTTP ${status}`);
  if (data?.message) parts.push(data.message);
  if (Array.isArray(data?.cause)) {
    for (const c of data.cause) {
      if (c.description) parts.push(c.description);
      else if (c.code) parts.push(String(c.code));
    }
  }
  if (data?.error) parts.push(String(data.error));
  if (parts.length) return parts.join(' — ');
  return e.message || 'Erro desconhecido';
}

class PaymentService {
  constructor() {
    this._applyTokenFromEnv();
  }

  _apiForTenant(tenant) {
    const token = resolveTokenForTenant(tenant || tenantFromContext());
    const available = tokenLooksValid(token);
    const api = axios.create({
      baseURL: 'https://api.mercadopago.com',
      timeout: Number(process.env.MP_API_TIMEOUT_MS) || 25000,
      headers: {
        Authorization: `Bearer ${token || ''}`,
        'Content-Type': 'application/json',
      },
    });
    return { api, available, testMode: isMpTestMode(token), token };
  }

  _applyTokenFromEnv() {
    const { api, available, testMode } = this._apiForTenant(null);
    this.api = api;
    this._mpAvailable = available;
    this._testMode = testMode;

    if (!this._mpAvailable) {
      logger.warn('[PAYMENT] TOKEN_MP não configurado — Mercado Pago desativado. Pagamentos entrarão em modo manual.');
    } else if (this._testMode) {
      logger.info('[PAYMENT] Mercado Pago em modo TEST/sandbox');
    }
  }

  isAvailable(tenant = null) {
    return this._apiForTenant(tenant).available;
  }

  _resolvePayerEmail(tenant, payerEmail) {
    const { resolveMpPayerEmail } = require('../tenant/tenantScope');
    return (payerEmail || resolveMpPayerEmail(tenant) || process.env.MP_PAYER_EMAIL || 'cliente@hanork.com').trim();
  }

  /**
   * Retry com backoff exponencial
   */
  async _withRetry(fn, maxRetries = 3, baseDelay = 1000) {
    let lastErr;
    for (let i = 0; i <= maxRetries; i++) {
      try {
        return await fn();
      } catch (e) {
        lastErr = e;
        const status = e.response?.status;
        // Não retentar erros de cliente
        if (status && status >= 400 && status < 500 && status !== 429) throw e;
        if (i < maxRetries) {
          const delay = baseDelay * Math.pow(2, i) + Math.random() * 500;
          logger.retry('MP API', i + 1, maxRetries, delay);
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }
    throw lastErr;
  }

  _buildPayer(payerEmail = null) {
    const email = (payerEmail || process.env.MP_PAYER_EMAIL || 'cliente@hanork.com').trim();
    const payer = {
      email: email.includes('@') ? email : 'cliente@hanork.com',
      first_name: (process.env.MP_PAYER_FIRST_NAME || 'Cliente').slice(0, 50),
      last_name: (process.env.MP_PAYER_LAST_NAME || 'Hanork').slice(0, 50),
    };
    const cpf = String(process.env.MP_PAYER_CPF || '').replace(/\D/g, '');
    if (cpf.length === 11) {
      payer.identification = { type: 'CPF', number: cpf };
    }
    return payer;
  }

  /**
   * Testa TOKEN_MP na subida do bot
   */
  async verifyConnection() {
    this._applyTokenFromEnv();
    if (!this._mpAvailable) {
      return { ok: false, reason: 'TOKEN_MP ausente ou inválido' };
    }

    const maxAttempts = 3;
    let lastErr = null;
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const { data } = await this.api.get('/users/me', { timeout: 15000 });
        return {
          ok: true,
          mpUserId: data.id,
          country: data.country_id,
          testMode: this._testMode,
        };
      } catch (e) {
        lastErr = e;
        const status = e.response?.status;
        if (status === 401 || status === 403) {
          this._mpAvailable = false;
          return { ok: false, reason: formatMpError(e), status };
        }
        if (i < maxAttempts - 1) {
          await new Promise((r) => setTimeout(r, 1500));
        }
      }
    }

    // Token com formato válido, mas rede lenta/timeout — não desligar PIX
    logger.warn(
      `[PAYMENT] Validação online falhou após ${maxAttempts} tentativas — mantendo MP ativo (${formatMpError(lastErr)})`
    );
    return {
      ok: true,
      offlineVerify: true,
      testMode: this._testMode,
      reason: formatMpError(lastErr),
    };
  }

  /**
   * Gera pagamento PIX
   */
  async createPix(amount, description, externalRef, payerEmail = null, tenant = null) {
    const { api, available } = this._apiForTenant(tenant);
    if (!available) {
      throw Object.assign(new Error('Mercado Pago não configurado. Configure TOKEN_MP no .env.'), { code: 'MP_UNAVAILABLE' });
    }
    try {
      const idempotencyKey = uuidv4();
      const unitAmount = formatMpAmount(amount);
      const ref = String(externalRef || '').slice(0, 64);
      const desc = String(description || 'Pedido').slice(0, 127);
      const payer = this._buildPayer(this._resolvePayerEmail(tenant, payerEmail));

      const body = {
        transaction_amount: unitAmount,
        description: desc,
        payment_method_id: 'pix',
        payer,
        external_reference: ref,
      };

      const webhookUrl = (process.env.WEBHOOK_URL || '').trim();
      if (webhookUrl.startsWith('https://')) {
        body.notification_url = webhookUrl;
      }

      const { data } = await this._withRetry(
        () =>
          api.post('/v1/payments', body, {
            headers: { 'X-Idempotency-Key': idempotencyKey },
          }),
        2,
        800
      );

      const qrCode = data.point_of_interaction?.transaction_data?.qr_code;
      if (!qrCode) {
        throw new Error('MP não retornou código PIX (qr_code vazio)');
      }

      logger.info(`[PAYMENT] PIX criado: ${data.id} - R$ ${unitAmount}`, {
        ref,
        tenantId: tenant?.id ?? null,
      });

      return {
        id: data.id,
        qr_code: qrCode,
        qr_code_base64: data.point_of_interaction?.transaction_data?.qr_code_base64,
        ticket_url: data.point_of_interaction?.transaction_data?.ticket_url,
        status: data.status,
        external_reference: ref,
      };
    } catch (e) {
      const detail = formatMpError(e);
      logger.error(`[PAYMENT] Erro ao criar PIX: ${detail}`, { status: e.response?.status, ref: externalRef });
      const err = new Error(detail);
      err.code = e.code || 'MP_PIX_ERROR';
      err.status = e.response?.status;
      throw err;
    }
  }

  /**
   * Gera checkout para cartão/boleto
   */
  getCheckoutInitPoint(preference, testMode = this._testMode) {
    if (!preference) return null;
    if (testMode) {
      return preference.sandbox_init_point || preference.init_point || null;
    }
    return preference.init_point || preference.sandbox_init_point || null;
  }

  formatError(e) {
    return formatMpError(e);
  }

  async createCheckout(amount, description, externalRef, tenant = null) {
    const { api, available, testMode } = this._apiForTenant(tenant);
    if (!available) {
      throw Object.assign(new Error('Mercado Pago não configurado. Configure TOKEN_MP no .env.'), { code: 'MP_UNAVAILABLE' });
    }
    try {
      const unitPrice = formatMpAmount(amount);
      const title = String(description || 'Pedido').replace(/[^\w\s#.\-áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ]/g, ' ').trim().slice(0, 127) || 'Pedido';
      const ref = String(externalRef || '').slice(0, 64);
      const itemId = `item-${ref.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || '1'}`;

      const preferenceBody = {
        items: [{
          id: itemId,
          title,
          quantity: 1,
          currency_id: 'BRL',
          unit_price: unitPrice,
        }],
        external_reference: ref,
        statement_descriptor: (process.env.MP_STATEMENT_DESCRIPTOR || 'HANORK').slice(0, 22),
      };

      const webhookUrl = (process.env.WEBHOOK_URL || '').trim();
      if (webhookUrl.startsWith('https://')) {
        preferenceBody.notification_url = webhookUrl;
      }

      // back_urls só com HTTPS público; auto_return opt-in (evita redirect quebrado no WebView do Telegram)
      const { resolvePublicOrigin } = require('./mpPublicUrl');
      const baseUrl = resolvePublicOrigin();
      if (baseUrl) {
        preferenceBody.back_urls = {
          success: `${baseUrl}/mp/success`,
          failure: `${baseUrl}/mp/failure`,
          pending: `${baseUrl}/mp/pending`,
        };
        if (process.env.MP_AUTO_RETURN === '1') {
          preferenceBody.auto_return = 'approved';
        }
      }

      const { data } = await this._withRetry(
        () => api.post('/checkout/preferences', preferenceBody),
        2,
        800
      );

      const initPoint = this.getCheckoutInitPoint(data, testMode);
      if (!initPoint) {
        throw new Error('MP não retornou URL de pagamento (init_point vazio)');
      }

      logger.info(`[PAYMENT] Checkout criado: ${data.id} - R$ ${unitPrice}`, {
        testMode: this._testMode,
        ref,
      });

      return {
        id: data.id,
        init_point: data.init_point,
        sandbox_init_point: data.sandbox_init_point,
        checkout_url: initPoint,
      };
    } catch (e) {
      const detail = formatMpError(e);
      logger.error(`[PAYMENT] Erro ao criar checkout: ${detail}`, {
        status: e.response?.status,
        ref: externalRef,
      });
      const err = new Error(detail);
      err.code = e.code || 'MP_CHECKOUT_ERROR';
      err.status = e.response?.status;
      throw err;
    }
  }

  /** Busca preferência Checkout Pro (redirect /mp/go). */
  async getPreference(preferenceId, tenant = null) {
    const { api, available, testMode } = this._apiForTenant(tenant);
    if (!available || !preferenceId) return null;
    try {
      const { data } = await this._withRetry(() =>
        api.get(`/checkout/preferences/${encodeURIComponent(String(preferenceId))}`)
      );
      const initPoint = this.getCheckoutInitPoint(data, testMode);
      return {
        id: data.id,
        init_point: initPoint,
        external_reference: data.external_reference,
      };
    } catch (e) {
      if (e.response?.status === 404) return null;
      throw e;
    }
  }

  /**
   * Verifica status do pagamento por ID
   */
  async getStatus(paymentId, tenant = null) {
    const { api, available } = this._apiForTenant(tenant);
    if (!available) return null;
    try {
      const { data } = await this._withRetry(() =>
        api.get(`/v1/payments/${paymentId}`)
      );

      return {
        id: data.id,
        status: data.status,
        status_detail: data.status_detail,
        transaction_amount: data.transaction_amount,
        payment_method_id: data.payment_method_id,
        external_reference: data.external_reference,
        date_created: data.date_created,
        date_approved: data.date_approved
      };
    } catch (e) {
      if (e.response?.status === 404) {
        logger.warn(`[PAYMENT] Pagamento ${paymentId} não encontrado`);
        return null;
      }
      logger.error(`[PAYMENT] Erro ao verificar status ${paymentId}: ${e.message}`);
      throw e;
    }
  }

  /** Escolhe o pagamento mais relevante dentro de merchant orders (Checkout Pro). */
  _pickPaymentFromMerchantOrders(orders) {
    if (!Array.isArray(orders) || !orders.length) return null;
    const rank = (status) => {
      if (status === 'approved') return 3;
      if (status === 'in_process' || status === 'pending') return 2;
      return 1;
    };
    let best = null;
    let bestRank = 0;
    for (const order of orders) {
      for (const payment of order.payments || []) {
        if (!payment?.id) continue;
        const r = rank(payment.status);
        if (r >= bestRank) {
          bestRank = r;
          best = {
            id: payment.id,
            status: payment.status,
            external_reference: payment.external_reference || order.external_reference,
            transaction_amount: payment.transaction_amount ?? payment.total_paid_amount,
            payment_method_id: payment.payment_method_id,
          };
        }
      }
    }
    return best;
  }

  /** Busca pagamentos vinculados a uma preferência Checkout Pro. */
  async findByPreference(preferenceId, tenant = null, opts = null) {
    const { api, available } = this._apiForTenant(tenant);
    if (!available || !preferenceId) return null;
    const lite = opts?.lite === true;
    const timeout = lite
      ? Math.min(12000, Number(process.env.MP_API_TIMEOUT_MS) || 25000)
      : undefined;
    try {
      const { data } = await this._withRetry(() =>
        api.get('/merchant_orders/search', {
          params: { preference_id: String(preferenceId) },
          timeout,
        })
      );
      const payment = this._pickPaymentFromMerchantOrders(data?.elements);
      if (!payment) return null;
      logger.info(`[PAYMENT] Encontrado por preference: ${payment.id} - ${payment.status}`);
      if (lite) return payment;
      const full = await this.getStatus(payment.id, tenant);
      return full || payment;
    } catch (e) {
      const mpErr = formatMpError(e);
      if (e.response?.status === 404) return null;
      logger.debug(`[PAYMENT] preference lookup vazio/erro: ${mpErr}`, { preferenceId });
      return null;
    }
  }

  /**
   * Busca pagamento por external_reference
   */
  async findByReference(externalRef, tenant = null, opts = null) {
    const { api, available } = this._apiForTenant(tenant);
    if (!available) return null;
    const lite = opts?.lite === true;
    try {
      const { data } = await this._withRetry(() =>
        api.get(`/v1/payments/search`, {
          params: { external_reference: externalRef },
          timeout: lite
            ? Math.min(12000, Number(process.env.MP_API_TIMEOUT_MS) || 25000)
            : undefined,
        })
      );

      if (data.results && data.results.length > 0) {
        const approved = data.results.find((p) => p.status === 'approved');
        const payment = approved || data.results[0];
        logger.info(`[PAYMENT] Encontrado por ref: ${payment.id} - ${payment.status}`);
        if (lite) {
          return {
            id: payment.id,
            status: payment.status,
            external_reference: payment.external_reference,
            transaction_amount: payment.transaction_amount,
            payment_method_id: payment.payment_method_id,
          };
        }
        const full = await this.getStatus(payment.id, tenant);
        return full || {
          id: payment.id,
          status: payment.status,
          external_reference: payment.external_reference,
          transaction_amount: payment.transaction_amount,
          payment_method_id: payment.payment_method_id,
        };
      }

      return null;
    } catch (e) {
      const mpErr = formatMpError(e);
      logger.error(`[PAYMENT] Erro ao buscar por ref ${externalRef}: ${mpErr}`);
      return null;
    }
  }

  /**
   * Verifica se pagamento está aprovado
   */
  async isApproved(paymentId) {
    try {
      const status = await this.getStatus(paymentId);
      return status?.status === 'approved';
    } catch (e) {
      return false;
    }
  }

  /**
   * Reembolsa pagamento
   */
  async refund(paymentId) {
    try {
      const { data } = await this._withRetry(() =>
        this.api.post(`/v1/payments/${paymentId}/refunds`)
      );

      logger.info(`[PAYMENT] Reembolsado: ${paymentId}`);
      return {
        id: data.id,
        payment_id: data.payment_id,
        amount: data.amount,
        status: data.status
      };
    } catch (e) {
      logger.error(`[PAYMENT] Erro ao reembolsar ${paymentId}: ${e.message}`);
      throw e;
    }
  }

  /**
   * Cancela pagamento pendente
   */
  async cancel(paymentId) {
    try {
      const { data } = await this._withRetry(() =>
        this.api.put(`/v1/payments/${paymentId}`, {
          status: 'cancelled'
        })
      );

      logger.info(`[PAYMENT] Cancelado: ${paymentId}`);
      return {
        id: data.id,
        status: data.status
      };
    } catch (e) {
      logger.error(`[PAYMENT] Erro ao cancelar ${paymentId}: ${e.message}`);
      throw e;
    }
  }

  /**
   * Webhook: tenta token global e tokens por loja SaaS
   */
  async getStatusForWebhook(paymentId) {
    let payment = await this.getStatus(paymentId, null);
    if (payment) {
      const { resolveTenantForWebhook } = require('../tenant/planPayment');
      const tenant = await resolveTenantForWebhook(payment.external_reference, null);
      return { payment, tenant };
    }
    const TenantService = require('../tenant/TenantService');
    const { rows } = TenantService.getAll({ limit: 150 });
    for (const t of rows) {
      if (!t.token_mp) continue;
      payment = await this.getStatus(paymentId, t);
      if (payment) return { payment, tenant: t };
    }
    return { payment: null, tenant: null };
  }
}

// Singleton
const instance = new PaymentService();
module.exports = instance;
module.exports.formatMpAmount = formatMpAmount;
module.exports.formatMpError = formatMpError;
module.exports.isMpTestMode = isMpTestMode;
