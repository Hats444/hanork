'use strict';

const fs = require('fs');
const { deferBackground } = require('../../utils/defer');
const { getZeroDivuClient } = require('./ZeroDivuClient');
const { resolveSession } = require('./waSessionsManifest');

const QR_REFRESH_MIN_MS = 8000;

class ZeroDivuLoginService {
  constructor() {
    this._flow = new Map();
    this._eventOffset = 0;
    this._eventTimer = null;
  }

  _pairInstructions(formatted, phone) {
    return (
      ' <b>WhatsApp — código de pareamento</b>\n\n' +
      `Código: <code>${formatted || '????-????'}</code>\n` +
      (phone ? `Número: <code>${phone}</code>\n\n` : '\n') +
      'No celular: <b>WhatsApp → Aparelhos conectados → Conectar com número</b>\n\n' +
      '<i>Expira em poucos minutos — use</i> <code>/wa_pair TELEFONE</code> <i>para gerar outro.</i>'
    );
  }

  _normalizePhone(raw) {
    const digits = String(raw || '').replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 15) return null;
    return digits;
  }

  _qrInstructions() {
    return (
      ' <b>WhatsApp — login por QR</b>\n\n' +
      'No celular: <b>WhatsApp → Aparelhos conectados → Conectar</b>\n\n' +
      '<i>O QR renova sozinho — esta mensagem será atualizada.</i>\n' +
      'Expirou? <code>/wa_novo_qr</code>\n\n' +
      'Alternativa: <code>/wa_pair TELEFONE</code>'
    );
  }

  isAwaiting(uid) {
    return this._flow.has(Number(uid));
  }

  async cancel(uid) {
    this._flow.delete(Number(uid));
  }

  _ensureEventWatcher() {
    if (this._eventTimer) return;
    this._eventTimer = setInterval(() => {
      this._pollEvents().catch(() => {});
    }, 600);
    if (this._eventTimer.unref) this._eventTimer.unref();
  }

  _clientForFlow(s) {
    return s?.client || getZeroDivuClient();
  }

  _cmdPrefixForFlow(s) {
    if (s?.cmdPrefix) return s.cmdPrefix;
    return 'wa';
  }

  async _pollEvents() {
    if (!this._flow.size) return;
    for (const [uid, s] of this._flow.entries()) {
      const client = this._clientForFlow(s);
      if (s._eventOffset == null) {
        try {
          const eventsFile = client.files.events;
          s._eventOffset = fs.existsSync(eventsFile) ? fs.statSync(eventsFile).size : 0;
        } catch {
          s._eventOffset = 0;
        }
      }
      const { events, nextOffset } = await client.readEventsSince(s._eventOffset);
      s._eventOffset = nextOffset;
      for (const ev of events) {
        if (ev.type === 'wa.pairing_code') {
          if (s.step === 'pair' && (ev.formatted || ev.code)) {
            await this._notify(
              s,
              this._pairInstructions(ev.formatted || ev.code, ev.phone || s.pairPhone)
            );
          }
        }
        if (ev.type === 'wa.pairing_failed') {
          if (s.step === 'pair') {
            const cmd = this._cmdPrefixForFlow(s);
            await this._notify(
              s,
              `Falha no pareamento: ${ev.message || 'erro desconhecido'}\n` +
                `Tente <code>/${cmd}_pair DDI+numero</code> ou <code>/${cmd}_conectar</code> (QR).`
            );
            this._flow.delete(uid);
          }
        }
        if (ev.type === 'wa.qr') {
          if (s.step === 'qr' && ev.pngBase64) {
            await this._sendQrPhoto(s, ev.pngBase64, { tokenKey: ev.at });
          }
        }
        if (ev.type === 'wa.connected') {
          const cmd = this._cmdPrefixForFlow(s);
          await this._clearQrPhoto(s);
          await this._notify(
            s,
            `<b>WhatsApp conectado</b>${ev.phone ? `\n<code>${ev.phone}</code>` : ''}\n\n` +
              `Use <code>/${cmd}_status</code> para ver grupos e fila.`
          );
          this._flow.delete(uid);
        }
        if (ev.type === 'wa.disconnected') {
          const cmd = this._cmdPrefixForFlow(s);
          await this._notify(
            s,
            `WhatsApp desconectado (${ev.reason || 'unknown'}).\n` +
              `Use <code>/${cmd}_conectar</code> (QR) ou <code>/${cmd}_pair TELEFONE</code>.`
          );
        }
      }
    }
  }

  async _notify(s, text) {
    if (!s?.notify?.telegram || !s.notify.chatId) return;
    try {
      await s.notify.telegram.sendMessage(s.notify.chatId, text, { parse_mode: 'HTML' });
    } catch {
      /* ignore */
    }
  }

  async _clearQrPhoto(s) {
    if (!s?.qrMessageId || !s.notify?.telegram) return;
    try {
      await s.notify.telegram.deleteMessage(s.notify.chatId, s.qrMessageId);
    } catch {
      /* ignore */
    }
    s.qrMessageId = null;
  }

  async _sendQrPhoto(s, pngBase64, { tokenKey = null, force = false } = {}) {
    if (!s?.notify?.telegram || !s.notify.chatId || !pngBase64) return;

    const now = Date.now();
    if (!force && tokenKey && tokenKey === s.lastQrToken) return;
    if (!force && s.lastQrSentAt && now - s.lastQrSentAt < QR_REFRESH_MIN_MS) return;

    s.lastQrToken = tokenKey || s.lastQrToken;
    s.lastQrSentAt = now;

    const caption = this._qrInstructions();
    const { telegram, chatId } = s.notify;
    const source = Buffer.from(pngBase64, 'base64');

    try {
      if (s.qrMessageId) {
        try {
          await telegram.editMessageMedia(
            chatId,
            s.qrMessageId,
            undefined,
            { type: 'photo', media: { source }, caption, parse_mode: 'HTML' }
          );
          return;
        } catch {
          await telegram.deleteMessage(chatId, s.qrMessageId).catch(() => {});
          s.qrMessageId = null;
        }
      }

      const sent = await telegram.sendPhoto(chatId, { source }, { caption, parse_mode: 'HTML' });
      s.qrMessageId = sent?.message_id ?? null;
    } catch {
      await this._notify(s, caption);
    }
  }

  async startLogin(uid, ctx, sessionId = null) {
    const nuid = Number(uid);
    const client = sessionId ? getZeroDivuClient(sessionId) : getZeroDivuClient();
    const conf = sessionId ? resolveSession(sessionId) : null;
    const cmd = conf?.cmdPrefix || 'wa';
    const label = conf?.displayName || 'WhatsApp';

    if (this.isAwaiting(nuid)) {
      return {
        ok: true,
        alreadyAwaiting: true,
        message:
          `<b>Já estou aguardando o QR (${label})</b>\n\n` +
          'A imagem chega em instantes (atualiza automaticamente).\n' +
          `Expirou? <code>/${cmd}_novo_qr</code>`,
      };
    }

    if (!client.isWorkerLikelyOnline()) {
      const ping = await client.sendCommand('wa.ping', {}, nuid).catch(() => null);
      if (!ping?.ok) {
        return {
          ok: false,
          offline: true,
          message: `<b>${label} offline</b>\n\nInicie com <code>node src/bot.js</code> e tente de novo.`,
        };
      }
    }

    const state = client.readState();
    if (state?.connected) {
      return {
        ok: true,
        alreadyConnected: true,
        message:
          `<b>${label} já conectado</b>` +
          (state.phone ? `\n<code>${state.phone}</code>` : '') +
          `\nGrupos: <b>${state.activeGroups ?? '?'}/${state.maxGroups ?? '?'}</b>`,
      };
    }

    this._flow.set(nuid, {
      step: 'qr',
      client,
      sessionId,
      cmdPrefix: cmd,
      notify: { telegram: ctx.telegram, chatId: ctx.chat?.id },
      qrMessageId: null,
      lastQrToken: null,
      lastQrSentAt: 0,
      _eventOffset: null,
    });
    this._ensureEventWatcher();

    const ack = await client.sendCommand('wa.start_login', {}, nuid);
    if (!ack.ok) {
      this._flow.delete(nuid);
      return {
        ok: false,
        message: `${ack.message || ack.error || 'Falha ao iniciar login'}`,
      };
    }

    deferBackground('wa-login-events', () => this._pollEvents());

    return {
      ok: true,
      message:
        `<b>Aguardando QR (${label})</b>\n\n` +
        'A imagem chega em instantes.\n' +
        `Expirou? <code>/${cmd}_novo_qr</code>\n\n` +
        `Alternativa: <code>/${cmd}_pair 5511999999999</code>`,
    };
  }

  async showConnectChoice(uid, ctx, sessionId = null) {
    const r = await this.startLogin(uid, ctx, sessionId);
    return { ...r, choose: false };
  }

  async startPairing(uid, ctx, phoneRaw, sessionId = null) {
    const nuid = Number(uid);
    const client = sessionId ? getZeroDivuClient(sessionId) : getZeroDivuClient();
    const conf = sessionId ? resolveSession(sessionId) : null;
    const cmd = conf?.cmdPrefix || 'wa';
    const label = conf?.displayName || 'WhatsApp';
    const phone = this._normalizePhone(phoneRaw);

    if (this.isAwaiting(nuid)) {
      return {
        ok: true,
        alreadyAwaiting: true,
        message:
          `<b>Já existe um fluxo de login em andamento (${label})</b>\n\n` +
          `Use <code>/${cmd}_novo_qr</code> (QR) ou aguarde a mensagem atualizar.`,
      };
    }

    if (!phone) {
      return {
        ok: false,
        message:
          `Número inválido.\n\nUso: <code>/${cmd}_pair 5511999999999</code> (DDI + DDD + número, só dígitos)`,
      };
    }

    if (!client.isWorkerLikelyOnline()) {
      const ping = await client.sendCommand('wa.ping', {}, nuid).catch(() => null);
      if (!ping?.ok) {
        return {
          ok: false,
          offline: true,
          message: `<b>${label} offline</b>\n\nInicie com <code>node src/bot.js</code> e tente de novo.`,
        };
      }
    }

    const state = client.readState();
    if (state?.connected) {
      return {
        ok: true,
        alreadyConnected: true,
        message:
          `<b>${label} já conectado</b>` +
          (state.phone ? `\n<code>${state.phone}</code>` : '') +
          `\nGrupos: <b>${state.activeGroups ?? '?'}/${state.maxGroups ?? '?'}</b>`,
      };
    }

    this._flow.set(nuid, {
      step: 'pair',
      client,
      sessionId,
      cmdPrefix: cmd,
      pairPhone: phone,
      notify: { telegram: ctx.telegram, chatId: ctx.chat?.id },
      qrMessageId: null,
      lastQrToken: null,
      lastQrSentAt: 0,
      _eventOffset: null,
    });
    this._ensureEventWatcher();

    const ack = await client.sendCommand('wa.start_pairing', { phone }, nuid);
    if (!ack.ok) {
      this._flow.delete(nuid);
      return {
        ok: false,
        message: ` ${ack.message || ack.error || 'Falha ao iniciar pareamento'}`,
      };
    }

    const r = ack.result?.result || ack.result || {};
    if (r.formatted || r.code) {
      deferBackground('wa-pair-events', () => this._pollEvents());
      return {
        ok: true,
        message: this._pairInstructions(r.formatted || r.code, phone),
      };
    }

    deferBackground('wa-pair-events', () => this._pollEvents());

    return {
      ok: true,
      message:
        `<b>Gerando código de pareamento (${label})</b>\n\n` +
        `Número: <code>${phone}</code>\n\n` +
        'O código de 8 dígitos chega em instantes.',
    };
  }

  async refreshQr(uid, ctx, sessionId = null) {
    const nuid = Number(uid);
    const client = sessionId ? getZeroDivuClient(sessionId) : getZeroDivuClient();
    const conf = sessionId ? resolveSession(sessionId) : null;
    const cmd = conf?.cmdPrefix || 'wa';
    const state = client.readState();
    if (state?.connected) {
      return {
        ok: false,
        message: 'Já conectado — não é necessário novo QR.',
      };
    }

    if (!this._flow.has(nuid)) {
      this._flow.set(nuid, {
        step: 'qr',
        client,
        sessionId,
        cmdPrefix: cmd,
        notify: { telegram: ctx.telegram, chatId: ctx.chat?.id },
        qrMessageId: null,
        lastQrToken: null,
        lastQrSentAt: 0,
        _eventOffset: null,
      });
      this._ensureEventWatcher();
    }

    const ack = await client.sendCommand('wa.refresh_qr', {}, nuid);
    if (!ack.ok) {
      return { ok: false, message: `${ack.message || ack.error}` };
    }

    deferBackground('wa-refresh-events', () => this._pollEvents());

    return {
      ok: true,
      message: `<b>Novo QR solicitado</b> — aguarde a imagem atualizada.\n<code>/${cmd}_novo_qr</code>`,
    };
  }
}

let singleton = null;

function getZeroDivuLoginService() {
  if (!singleton) singleton = new ZeroDivuLoginService();
  return singleton;
}

module.exports = { ZeroDivuLoginService, getZeroDivuLoginService };
