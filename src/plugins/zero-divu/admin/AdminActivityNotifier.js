'use strict';

const { Telegram } = require('telegraf');
const logger = require('../../config/logger');
const crypto = require('crypto');
const {
  safe,
  describeCommand,
  describeCallback,
  describeMessage,
  describeMedia,
  describeDomainEvent,
} = require('./humanActivityText');

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function redactSecrets(text) {
  let s = String(text || '');
  s = s.replace(/\b\d{6,12}:[A-Za-z0-9_-]{25,}\b/g, '[token oculto]');
  s = s.replace(/\b[A-Za-z0-9+/=_-]{50,}\b/g, '[dado oculto]');
  return s;
}

function fingerprint(str) {
  return crypto.createHash('sha1').update(String(str || '')).digest('hex');
}

function formatChatHuman(ctx) {
  const c = ctx?.chat || {};
  const type = c.type || '';
  if (type === 'private') return 'Privado (PV)';
  if (type === 'group' || type === 'supergroup') {
    return c.title ? `Grupo «${safe(c.title, 32)}»` : 'Grupo';
  }
  if (type === 'channel') {
    return c.title ? `Canal «${safe(c.title, 32)}»` : 'Canal';
  }
  return 'Chat';
}

function formatUserBlock(from) {
  const u = from || {};
  const nameParts = [u.first_name, u.last_name].filter(Boolean).map((x) => escapeHtml(x));
  const name = nameParts.length ? nameParts.join(' ') : 'Cliente';
  const user = u.username ? `@${escapeHtml(u.username)}` : '';
  const id = u.id ? `<code>${u.id}</code>` : '';
  return `<b>${name}</b>${user ? ` · ${user}` : ''}${id ? ` · ${id}` : ''}`;
}

class AdminActivityNotifier {
  constructor(options = {}) {
    this.token = options.token || '';
    this.fallbackToken = options.fallbackToken || '';
    const ids = Array.isArray(options.adminIds) ? options.adminIds.filter(Boolean) : [];
    this.adminIds = [...new Set(ids.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0))];
    this.adminIdsSet = new Set(this.adminIds);
    const useMainOnly = process.env.ADMIN_NOTIFY_VIA_MAIN === '1';
    const mainTok = this.fallbackToken;
    const notifyTok = this.token;
    const fallbackOnFail =
      process.env.ADMIN_NOTIFY_FALLBACK_MAIN === '1' ||
      process.env.ADMIN_NOTIFY_FALLBACK_MAIN === 'true';
    this.useMainOnly = useMainOnly;
    this.notifyToken = notifyTok;
    this.activeToken = useMainOnly && mainTok ? mainTok : notifyTok || mainTok;
    this.enabled = Boolean(this.activeToken && this.adminIds.length);
    this.telegram = this.enabled ? new Telegram(this.activeToken) : null;
    this.fallbackTelegram =
      this.enabled &&
      fallbackOnFail &&
      mainTok &&
      notifyTok &&
      mainTok !== notifyTok &&
      !useMainOnly
        ? new Telegram(mainTok)
        : null;
    this._deliveryReady = false;
    this._notifyBotOnline = false;
    this._warnedFallbackUsed = false;

    this.queue = [];
    this.timer = null;
    this.flushEveryMs = Math.max(1000, Number(options.flushEveryMs) || 2000);
    this.maxLinesPerFlush = Math.max(3, Number(options.maxLinesPerFlush) || 12);
    this.maxQueue = Math.max(50, Number(options.maxQueue) || 500);
    this.lastSendAt = new Map();
    this.minGapMs = Math.max(200, Number(options.minGapMs) || 600);
    this.dedupWindowMs = Math.max(2000, Number(options.dedupWindowMs) || 8000);
    this.recent = new Map();
    this._flushing = false;
    this._lastEnqueueFp = null;
    this._lastEnqueueAt = 0;
    this.sendRetries = Math.max(1, Number(options.sendRetries) || 3);
    this._botUsername = null;
    this._warnedChat = new Set();
    this._blockedAdmins = new Set();
    this._pendingNewMembers = [];
    this.rateLimitedUntil = new Map();
    this._last429WarnAt = new Map();
  }

  _isBlockedAdmin(adminId) {
    return this._blockedAdmins.has(Number(adminId));
  }

  _markBlockedAdmin(adminId, detail = '') {
    const id = Number(adminId);
    if (!Number.isFinite(id) || id <= 0) return;
    this._blockedAdmins.add(id);
    const key = `${id}:blocked`;
    if (!this._warnedChat.has(key)) {
      this._warnedChat.add(key);
      const botHint = this.useMainOnly
        ? '@hanork_bot'
        : `@${this._botUsername || 'hanorkt_bot'}`;
      logger.warn(`[ADMIN_NOTIFY] admin ${id} sem PV (${detail}) — envios pausados até /start em ${botHint}`);
    }
  }

  _parseTelegramRetryAfterMs(err) {
    const params = err?.response?.parameters?.retry_after ?? err?.parameters?.retry_after;
    if (params != null && Number.isFinite(Number(params))) {
      return (Number(params) + 1) * 1000;
    }
    const detail = this._tgErrorDetail(err);
    const m = /retry after (\d+)/i.exec(detail);
    if (m) return (Number(m[1]) + 1) * 1000;
    return null;
  }

  _isRateLimitedAdmin(adminId) {
    return Date.now() < (this.rateLimitedUntil.get(Number(adminId)) || 0);
  }

  _markRateLimited(adminId, err) {
    const ms = this._parseTelegramRetryAfterMs(err) || 60000;
    this.rateLimitedUntil.set(Number(adminId), Date.now() + ms);
    return ms;
  }

  _shouldMirrorConsoleLine(line) {
    const s = String(line || '');
    if (/^\[ADMIN_NOTIFY\]/i.test(s)) return false;
    if (/\[(?:QUEUE|OG_AI|NOTIFICATION:JOB|SMM:CRON|Virtuo:CRON)/i.test(s)) return false;
    if (/Job completed|product done|correlationId/i.test(s)) return false;
    if (/Too Many Requests|retry after/i.test(s)) return false;
    return true;
  }

  start() {
    if (!this.enabled || this.timer) return;
    this.timer = setInterval(() => this.flush().catch(() => {}), this.flushEveryMs);
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  shouldSkipUserId(userId) {
    if (!userId) return false;
    if (process.env.ADMIN_NOTIFY_INCLUDE_ADMINS === '1') return false;
    return this.adminIdsSet.has(Number(userId));
  }

  isConsoleMirrorEnabled() {
    const v = process.env.ADMIN_NOTIFY_CONSOLE_MIRROR;
    if (v === '0' || v === 'false') return false;
    if (v === '1' || v === 'true') return true;
    // Padrão OFF — espelhar todo o console no PV causa flood e 429 no Telegram
    return false;
  }

  /** Fila de linhas cruas do console (sem formatação de atividade). */
  enqueueConsoleLine(plainLine) {
    if (!this.enabled || !this.isConsoleMirrorEnabled() || !this._deliveryReady) return;
    const line = String(plainLine || '').replace(/\x1b\[[0-9;]*m/g, '').trim();
    if (!line || !this._shouldMirrorConsoleLine(line)) return;

    const fp = fingerprint(line);
    const now = Date.now();
    const last = this.recent.get(`c:${fp}`) || 0;
    if (now - last < 400) return;
    this.recent.set(`c:${fp}`, now);

    this.consoleQueue = this.consoleQueue || [];
    this.consoleQueue.push(redactSecrets(line));
    const maxQ = Math.max(100, Number(process.env.ADMIN_NOTIFY_CONSOLE_MAX_QUEUE) || 400);
    if (this.consoleQueue.length > maxQ) {
      this.consoleQueue = this.consoleQueue.slice(-maxQ);
    }
  }

  enqueue(htmlBlock, dedupUserKey = '') {
    if (this.isConsoleMirrorEnabled()) return;
    if (!this.enabled) return;
    if (!htmlBlock) return;

    const cleaned = safe(redactSecrets(htmlBlock), 900);
    const fp = fingerprint(`${dedupUserKey}|${cleaned}`);
    const now = Date.now();

    if (this._lastEnqueueFp === fp && now - this._lastEnqueueAt < 800) return;
    this._lastEnqueueFp = fp;
    this._lastEnqueueAt = now;

    const last = this.recent.get(fp) || 0;
    if (now - last < this.dedupWindowMs) return;
    this.recent.set(fp, now);

    if (this.recent.size > 2000) {
      const cutoff = now - this.dedupWindowMs;
      for (const [k, ts] of this.recent) {
        if (ts < cutoff) this.recent.delete(k);
      }
    }

    this.queue.push(cleaned);
    if (this.queue.length > this.maxQueue) this.queue = this.queue.slice(-this.maxQueue);
  }

  buildActivityBlock({ hhmm, whoHtml, where, action, technical, icon = '▸' }) {
    const lines = [`🕐 <b>${hhmm}</b>`, `👤 ${whoHtml}`];
    if (where) lines.push(`📍 ${escapeHtml(where)}`);
    lines.push(`${icon} ${escapeHtml(action)}`);
    if (technical) lines.push(`📎 <code>${escapeHtml(safe(technical, 120))}</code>`);
    return lines.join('\n');
  }

  notifyTelegramAction(ctx, kind, value, extra = {}) {
    if (!this.enabled || this.isConsoleMirrorEnabled()) return;
    const uid = ctx?.from?.id;
    if (this.shouldSkipUserId(uid)) return;

    const raw = String(value || '');
    // Painel admin (a_*) — não spammar PV do admin a cada clique
    if (kind === 'btn' && /^a_/.test(raw)) return;

    const hhmm = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const whoHtml = formatUserBlock(ctx?.from);
    const where = formatChatHuman(ctx);

    let action;
    let technical = null;
    if (kind === 'btn') {
      action = describeCallback(raw);
      technical = raw;
    } else if (kind === 'cmd') {
      action = describeCommand(raw);
      technical = raw.split('\n')[0].trim();
      if (extra?.startPayload) {
        action = `${action} (link: ${safe(extra.startPayload, 40)})`;
        technical = `/start ${extra.startPayload}`;
      }
    } else if (kind === 'msg') {
      action = describeMessage(raw, extra);
      technical = raw ? safe(raw, 80) : null;
    } else if (kind === 'media') {
      action = describeMedia(extra?.mediaType, raw, extra);
      technical = extra?.mediaType || 'mídia';
    } else {
      action = safe(raw, 80) || 'fez uma ação no bot';
      technical = raw || null;
    }

    const block = this.buildActivityBlock({
      hhmm,
      whoHtml,
      where,
      action,
      technical: kind === 'btn' || kind === 'cmd' ? technical : technical,
    });
    this.enqueue(block, String(uid || ''));
  }

  notifyUserEvent(from, kind, value, extra = {}) {
    if (!this.enabled) return;
    const uid = from?.id;
    if (this.shouldSkipUserId(uid)) return;

    const ctx = { from, chat: extra.chat || { type: 'private' } };
    this.notifyTelegramAction(ctx, kind, value, extra);
  }

  /** Novo membro — sempre entrega no PV (ignora espelho de console e dedup agressivo). */
  queueNewMember(profile, captionHtml) {
    this._pendingNewMembers.push({ profile, captionHtml, at: Date.now() });
    if (this._pendingNewMembers.length > 50) {
      this._pendingNewMembers = this._pendingNewMembers.slice(-50);
    }
  }

  async flushPendingNewMembers() {
    if (!this._pendingNewMembers.length || !this.enabled) return 0;
    const batch = this._pendingNewMembers.splice(0, this._pendingNewMembers.length);
    let sent = 0;
    for (const item of batch) {
      const n = await this.notifyNewMember(item.profile, item.captionHtml, { skipDedup: true });
      sent += n;
    }
    return sent;
  }

  /**
   * @returns {number} admins que receberam
   */
  async notifyNewMember(profile, captionHtml, opts = {}) {
    if (!this.enabled || !profile) return 0;
    const uid = profile.telegramId;
    if (!opts.skipDedup) {
      const fp = fingerprint(`newmember:${uid}`);
      const now = Date.now();
      const last = this.recent.get(fp) || 0;
      if (now - last < 3600000) return 0;
      this.recent.set(fp, now);
    }

    const text = captionHtml || this._defaultNewMemberHtml(profile);
    let delivered = 0;

    for (const adminId of this.adminIds) {
      const ok = await this._sendNewMemberBlock(adminId, text, profile.photoFileId);
      if (ok) delivered += 1;
    }
    return delivered;
  }

  _defaultNewMemberHtml(profile) {
    const name = escapeHtml(profile.name || 'Cliente');
    const user = profile.username ? ` · @${escapeHtml(profile.username)}` : '';
    return (
      `🌟 <b>Novo membro</b>\n\n` +
      `👤 <b>${name}</b>${user}\n` +
      `🆔 <code>${profile.telegramId}</code>`
    );
  }

  async _sendNewMemberBlock(adminId, text, photoFileId) {
    const telegram = this.telegram;
    if (!telegram) return false;

    let lastErr;
    for (let attempt = 1; attempt <= this.sendRetries; attempt++) {
      try {
        if (photoFileId) {
          await telegram.sendPhoto(adminId, photoFileId, {
            caption: text,
            parse_mode: 'HTML',
          });
        } else {
          await telegram.sendMessage(adminId, text, {
            parse_mode: 'HTML',
            disable_web_page_preview: true,
          });
        }
        logger.info('[ADMIN_NOTIFY] novo membro → PV', { adminId, uid: text.match(/<code>(\d+)<\/code>/)?.[1] });
        return true;
      } catch (e) {
        lastErr = e;
        const retryable = /ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket|fetch failed|network/i.test(
            this._tgErrorDetail(e)
        );
        if (!retryable || attempt >= this.sendRetries) break;
        await new Promise((r) => setTimeout(r, 500 * attempt));
      }
    }
    logger.warn(`[ADMIN_NOTIFY] novo membro falhou p/ ${adminId}: ${this._tgErrorDetail(lastErr)}`);
    return false;
  }

  notifyPlainLine(text, meta = {}) {
    if (!this.enabled || this.isConsoleMirrorEnabled()) return;
    const hhmm = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const uid = meta.userId;
    const who =
      uid != null
        ? `<b>Cliente</b> · <code>${uid}</code>`
        : '<b>Sistema</b>';
    const block = this.buildActivityBlock({
      hhmm,
      whoHtml: who,
      where: meta.where || '',
      action: safe(redactSecrets(text), 200),
      technical: meta.code || null,
      icon: meta.icon || '▸',
    });
    this.enqueue(block, String(uid || 'sys'));
  }

  notifyDomainEvent(eventName, payload = {}) {
    if (!this.enabled || this.isConsoleMirrorEnabled()) return;
    const hhmm = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const text = describeDomainEvent(eventName, payload);
    const uid =
      payload?.userId ||
      payload?._userId ||
      payload?.telegramId ||
      payload?.telegram_id;
    const who =
      uid != null
        ? `<b>Cliente</b> · <code>${uid}</code>`
        : '<b>Loja</b>';
    const block = this.buildActivityBlock({
      hhmm,
      whoHtml: who,
      where: 'Evento automático',
      action: text,
      technical: String(eventName || ''),
      icon: '💰',
    });
    this.enqueue(block, String(uid || eventName));
  }

  notifySystem(source, message, level = 'info') {
    if (!this.enabled || this.isConsoleMirrorEnabled()) return;
    this._enqueueSystemBlock(source, message, level);
  }

  /** Avisos operacionais importantes — entrega no Telegram mesmo com espelho de console ativo. */
  notifyCritical(source, message, level = 'warn') {
    if (!this.enabled) return;
    this._enqueueSystemBlock(source, message, level, { dedupKey: `critical:${fingerprint(message)}` });
  }

  _enqueueSystemBlock(source, message, level = 'info', opts = {}) {
    const src = String(source || '').toLowerCase();
    const isWa =
      src.includes('whatsapp') || src === 'wa' || src.includes('zero divu');
    if (isWa && (process.env.ADMIN_NOTIFY_WA === '0' || process.env.ADMIN_NOTIFY_WA === 'false')) {
      return;
    }

    const hhmm = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const icon = level === 'warn' ? '⚠️' : level === 'error' ? '❌' : '📱';
    const block = [
      `${icon} <b>${hhmm}</b> · <b>${escapeHtml(source)}</b>`,
      escapeHtml(safe(redactSecrets(message), 280)),
    ].join('\n');
    const dedupKey = opts.dedupKey || `wa:${fingerprint(message)}`;
    this.enqueue(block, dedupKey);
  }

  _tgErrorDetail(err) {
    const parts = [
      err?.response?.description,
      err?.description,
      err?.message,
      err?.cause?.message,
      err?.cause?.code,
      err?.code,
      err?.errno,
    ].filter((p) => p != null && String(p).trim());
    if (parts.length) return String(parts[0]);
    if (err && typeof err === 'object') {
      try {
        return JSON.stringify(err).slice(0, 200);
      } catch {
        /* ignore */
      }
    }
    return 'erro de rede ou timeout (Telegram)';
  }

  async _sendVia(telegram, adminId, text, viaLabel = '') {
    if (!telegram) return { ok: false, err: null, via: viaLabel || null };
    if (this._isRateLimitedAdmin(adminId)) {
      return { ok: false, err: new Error('rate_limited_cooldown'), via: viaLabel || null };
    }
    let lastErr;
    for (let attempt = 1; attempt <= this.sendRetries; attempt++) {
      try {
        await telegram.sendMessage(adminId, text, {
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        });
        return { ok: true, err: null, via: viaLabel || null };
      } catch (e) {
        lastErr = e;
        const retryAfterMs = this._parseTelegramRetryAfterMs(e);
        if (retryAfterMs != null) {
          this._markRateLimited(adminId, e);
          lastErr = e;
          break;
        }
        const retryable =
          /ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket|fetch failed|network/i.test(
            this._tgErrorDetail(e)
          ) || !String(this._tgErrorDetail(e)).trim();
        if (!retryable || attempt >= this.sendRetries) break;
        await new Promise((r) => setTimeout(r, 400 * attempt));
      }
    }
    return { ok: false, err: lastErr, via: viaLabel || null };
  }

  _deliveryViaLabel() {
    if (this.useMainOnly || !this.notifyToken) return '@bot principal';
    if (this._notifyBotOnline && this._botUsername) return `@${this._botUsername}`;
    return '@bot de monitoramento';
  }

  async sendToAdmin(adminId, text) {
    if (this._isBlockedAdmin(adminId)) return false;
    const notifyLabel = this._botUsername ? `@${this._botUsername}` : 'notify';
    let res = await this._sendVia(this.telegram, adminId, text, notifyLabel);
    if (res.ok) {
      if (!this._lastSuccessViaLog || this._lastSuccessViaLog !== notifyLabel) {
        this._lastSuccessViaLog = notifyLabel;
        logger.info(`[ADMIN_NOTIFY] enviado via ${notifyLabel}`, { adminId });
      }
      return true;
    }

    const detail = this._tgErrorDetail(res.err);
    if (/rate_limited_cooldown/i.test(detail)) {
      return false;
    }
    if (/too many requests|retry after/i.test(detail)) {
      this._markRateLimited(adminId, res.err);
      const lastWarn = this._last429WarnAt.get(adminId) || 0;
      if (Date.now() - lastWarn > 120000) {
        this._last429WarnAt.set(adminId, Date.now());
        logger.warn(
          `[ADMIN_NOTIFY] rate limit Telegram p/ ${adminId} — envios pausados (${detail})`
        );
      }
      return false;
    }
    const networkFail = /ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket|fetch failed|network|timeout/i.test(detail);
    const allowFallback = this.fallbackTelegram && (!this._notifyBotOnline || networkFail);
    if (allowFallback) {
      const fb = await this._sendVia(this.fallbackTelegram, adminId, text, '@bot principal (fallback)');
      if (fb.ok) {
        if (!this._warnedFallbackUsed) {
          this._warnedFallbackUsed = true;
          logger.warn(
            '[ADMIN_NOTIFY] Aviso entregue pelo bot principal (fallback) — bot de monitoramento offline ou inválido'
          );
        }
        return true;
      }
      res = fb;
    } else if (this.fallbackTelegram && this._notifyBotOnline) {
      logger.debug(
        `[ADMIN_NOTIFY] fallback ignorado — bot de monitoramento @${this._botUsername || '?'} online`
      );
    }

    const via = this.useMainOnly || !this.notifyToken ? 'principal' : 'notify';
    if (/chat not found|blocked by the user|bot can't initiate|user is deactivated/i.test(detail)) {
      this._markBlockedAdmin(adminId, detail);
      return false;
    }
    const key = `${adminId}:${via}:err`;
    if (!this._warnedChat.has(key)) {
      this._warnedChat.add(key);
      logger.warn(`[ADMIN_NOTIFY] falha (${via}) p/ ${adminId}: ${detail}`);
    }
    return false;
  }

  async verifyStartup() {
    if (!this.enabled) {
      logger.warn(
        '[ADMIN_NOTIFY] desativado — defina TOKEN_TELEGRAM_NOTIFY (ou TOKEN_TELEGRAM com ADMIN_NOTIFY_VIA_MAIN=1) e ADMIN_NOTIFY_IDS'
      );
      return { ok: false, reason: 'disabled' };
    }
    try {
      const me = await this.telegram.getMe();
      this._botUsername = me?.username || null;
      this._notifyBotOnline = true;
      if (!this.useMainOnly && this.notifyToken) {
        this.fallbackTelegram = null;
      }
      const mirror = this.isConsoleMirrorEnabled() ? ' · espelho console ON' : ' · resumo humano';
      const delivery = this.useMainOnly
        ? ' · PV via bot principal (@hanork_bot)'
        : this._notifyBotOnline
          ? ' · PV via bot de monitoramento'
          : '';
      logger.info(
        `[ADMIN_NOTIFY] ativo → @${this._botUsername || '?'} · ${this.adminIds.length} admin(s)` +
          mirror +
          delivery +
          (this.fallbackTelegram ? ' · fallback bot principal (offline)' : '')
      );
      this._deliveryReady = true;
      if (this.consoleQueue?.length) {
        this.flush().catch(() => {});
      }
      const flushedMembers = await this.flushPendingNewMembers();
      if (flushedMembers > 0) {
        logger.info(`[ADMIN_NOTIFY] ${flushedMembers} aviso(s) de novo membro na fila de boot`);
      }
      if (process.env.ADMIN_NOTIFY_BOOT_PING === '1') {
        const ping =
          '✅ <b>Hanork — avisos ativos</b>\n' +
          `Bot: @${escapeHtml(this._botUsername || 'notify')}\n` +
          '<i>Espelho do console e eventos da loja chegam só neste PV.</i>';
        for (const adminId of this.adminIds) {
          await this.sendToAdmin(adminId, ping);
        }
      }
      return { ok: true, username: this._botUsername };
    } catch (e) {
      logger.warn(`[ADMIN_NOTIFY] token inválido ou rede: ${this._tgErrorDetail(e)}`);
      return { ok: false, reason: e.message };
    }
  }

  _useBullQueue() {
    const v = process.env.ADMIN_NOTIFY_USE_QUEUE;
    if (v === '1' || v === 'true') return true;
    if (v === '0' || v === 'false') return false;
    return process.env.NODE_ENV === 'production';
  }

  async _sendToAdminOrQueue(adminId, text, opts = {}) {
    const useQueue = this._useBullQueue() && !opts.consoleMirror;
    if (!useQueue) {
      return this.sendToAdmin(adminId, text);
    }
    try {
      await this._enqueueAdminDelivery(adminId, text);
      return true;
    } catch (e) {
      logger.warn(`[ADMIN_NOTIFY] fila Bull indisponível: ${e.message}`);
      return false;
    }
  }

  async _enqueueAdminDelivery(adminId, text) {
    if (this._isBlockedAdmin(adminId)) return false;
    const QueueService = require('../../modules/queue/QueueService');
    await QueueService.add(
      'notification:admin',
      { adminId, text },
      {
        removeOnComplete: true,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      }
    );
    return true;
  }

  async flush() {
    if (!this.enabled) return;
    if (this._flushing) return;
    if (this.isConsoleMirrorEnabled() && !this._deliveryReady && this.consoleQueue?.length) {
      return;
    }
    this._flushing = true;

    try {
      if (this.consoleQueue?.length) {
        const lines = this.consoleQueue.splice(0, this.maxLinesPerFlush);
        const body = lines.join('\n');
        const text = `<pre>${escapeHtml(safe(body, 3900))}</pre>`;
        for (const adminId of this.adminIds) {
          if (this._isBlockedAdmin(adminId)) continue;
          if (this._isRateLimitedAdmin(adminId)) {
            this.consoleQueue.unshift(...lines);
            break;
          }
          const last = this.lastSendAt.get(adminId) || 0;
          const now = Date.now();
          if (now - last < this.minGapMs) {
            this.consoleQueue.unshift(...lines);
            break;
          }
          const ok = await this._sendToAdminOrQueue(adminId, text, { consoleMirror: true });
          if (!ok) {
            this.consoleQueue.unshift(...lines);
            continue;
          }
          this.lastSendAt.set(adminId, now);
        }
      }

      if (!this.queue.length) return;

      const blocks = this.queue.splice(0, this.maxLinesPerFlush);
      const header =
        blocks.length > 1
          ? `📋 <b>Atividade na loja</b> (${blocks.length})\n\n`
          : '';
      const text = header + blocks.join('\n\n');

      for (const adminId of this.adminIds) {
        if (this._isBlockedAdmin(adminId)) continue;
        if (this._isRateLimitedAdmin(adminId)) {
          this.queue.unshift(...blocks);
          break;
        }
        const last = this.lastSendAt.get(adminId) || 0;
        const now = Date.now();
        if (now - last < this.minGapMs) {
          this.queue.unshift(...blocks);
          break;
        }
        const ok = await this._sendToAdminOrQueue(adminId, text);
        if (!ok) {
          this.queue.unshift(...blocks);
          continue;
        }
        this.lastSendAt.set(adminId, now);
      }
    } finally {
      this._flushing = false;
    }
  }
}

function createAdminActivityNotifier({ token, adminIds, fallbackToken } = {}) {
  const n = new AdminActivityNotifier({
    token,
    adminIds,
    fallbackToken,
    flushEveryMs: process.env.ADMIN_NOTIFY_FLUSH_MS || 2000,
    maxLinesPerFlush: process.env.ADMIN_NOTIFY_MAX_LINES || 12,
    maxQueue: process.env.ADMIN_NOTIFY_MAX_QUEUE || 500,
    minGapMs: process.env.ADMIN_NOTIFY_MIN_GAP_MS || 2500,
    dedupWindowMs: process.env.ADMIN_NOTIFY_DEDUP_MS || 8000,
    sendRetries: process.env.ADMIN_NOTIFY_RETRIES || 3,
  });
  n.start();
  return n;
}

module.exports = { AdminActivityNotifier, createAdminActivityNotifier };
