'use strict';

const fs = require('fs-extra');
const { getZeroDivuClient } = require('./ZeroDivuClient');
const waLogSettings = require('./waLogSettings');

const EVENT_LABELS = {
  'wa.qr': 'QR pronto · escaneie no Telegram',
  'wa.pairing_code': (ev) => `pairing · código ${ev.formatted || ev.code || '?'}`,
  'wa.pairing_failed': (ev) => `pairing falhou · ${ev.message || '?'}`,
  'wa.connected': (ev) => `WA conectado · ${ev.phone || '?'}`,
  'wa.disconnected': (ev) => `WA desconectado · ${ev.reason || 'unknown'}`,
  'wa.post': (ev) => {
    const s = ev.sent ?? 0;
    const t = ev.total ?? 0;
    const fail = (ev.failed ?? 0) + (ev.skipped ?? 0);
    if (ev.campaign === 'hanork-promo') {
      return `promo produto · ${s}/${t} status OK`;
    }
    if (ev.manual) return `post manual · ${s}/${t} ok`;
    if (s === 0) {
      return `post adiado · 0/${t} · ${ev.campaign || 'rotacao'}`;
    }
    if (fail > 0) return `post OK · +${s} ok · ${fail} pendente/falha`;
    return `post OK · +${s} ok · campanha ${ev.campaign || 'rotacao'}`;
  },
  'wa.join.start': (ev) =>
    `entrando · ${ev.link || '?'}${ev.queueTotal ? ` (fila ${ev.queuePos}/${ev.queueTotal})` : ''}`,
  'wa.join.ok': (ev) =>
    `entrada OK · ${ev.group || '?'} · ${ev.active ?? '?'}/${ev.max ?? '?'} grupos`,
  'wa.manual_join': (ev) => {
    const parts = [` você entrou · ${ev.group || '?'}`];
    if (ev.size) parts.push(`${ev.size} membros`);
    if (ev.statusHint) parts.push(ev.statusHint);
    if (ev.reentry) parts.push('(reativação)');
    return parts.join(' · ');
  },
  'wa.join.limit': (ev) =>
    `limite join · pausa ${ev.pauseMin ?? '?'}min · ${ev.active ?? '?'}/${ev.max ?? '?'} grupos`,
  'wa.leave': (ev) => `saiu · ${ev.group || '?'} · ${ev.reason || '?'}`,
  'wa.status_blocked': (ev) =>
    `status bloqueado · ${ev.group || '?'} · ${ev.reason || '?'}${ev.manualJoin ? ' (entrada manual)' : ''}`,
  'wa.cap': (ev) => `cap · ${ev.active ?? '?'}/${ev.max ?? '?'} · fila join pausada`,
};

const WARN_TYPES = new Set([
  'wa.join.limit',
  'wa.cap',
  'wa.disconnected',
  'wa.pairing_failed',
  'wa.leave',
  'wa.status_blocked',
]);

const CRITICAL_NOTIFY_TYPES = new Set(['wa.manual_join', ...WARN_TYPES]);

function formatEvent(ev) {
  const label = EVENT_LABELS[ev.type];
  if (!label) return null;
  return typeof label === 'function' ? label(ev) : label;
}

function startZeroDivuLogBridge(logger, options = {}) {
  const client = getZeroDivuClient();
  const eventsFile = client.files.events;
  const { bot, Msg } = options;
  let offset = 0;
  let started = false;
  const recentEvents = [];
  const MAX_RECENT = 200;

  try {
    if (fs.existsSync(eventsFile)) {
      offset = fs.statSync(eventsFile).size;
    }
  } catch {
    /* ignore */
  }

  const pushRecent = (ev, msg) => {
    recentEvents.push({
      at: ev.at || new Date().toISOString(),
      type: ev.type,
      msg,
    });
    if (recentEvents.length > MAX_RECENT) recentEvents.shift();
  };

  const { adminActivityNotifier } = options;

  const maybeTelegram = async (ev, msg, level) => {
    const useCritical =
      CRITICAL_NOTIFY_TYPES.has(ev.type) && adminActivityNotifier?.notifyCritical;
    const notifyFn = useCritical
      ? adminActivityNotifier.notifyCritical.bind(adminActivityNotifier)
      : adminActivityNotifier?.notifySystem?.bind(adminActivityNotifier);
    if (notifyFn) {
      notifyFn('WhatsApp', msg, level);
      return;
    }
    if (!bot || !Msg) return;
    const cfg = waLogSettings.get();
    if (!cfg.enabled) return;
    const adminId = cfg.adminId;
    if (!adminId) return;
    if (cfg.level === 'warn' && level !== 'warn') return;
    const line = `[WA] ${msg}`;
    try {
      await bot.telegram.sendMessage(adminId, line, { disable_notification: level !== 'warn' });
    } catch {
      /* ignore */
    }
  };

  const poll = async () => {
    try {
      if (!fs.existsSync(eventsFile)) return;
      const raw = await fs.readFile(eventsFile, 'utf8');
      if (raw.length <= offset) return;
      const chunk = raw.slice(offset);
      offset = raw.length;
      for (const line of chunk.split('\n').filter(Boolean)) {
        let ev;
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }
        const msg = formatEvent(ev);
        if (ev.type === 'wa.qr') {
          pushRecent(ev, 'QR');
          continue;
        }
        if (ev.type === 'wa.disconnected' && ev.reason === 'awaiting_login') {
          continue;
        }
        if (!msg) continue;
        const level =
          WARN_TYPES.has(ev.type) || ev.type === 'wa.manual_join' ? 'warn' : 'info';
        logger[level](msg, { category: 'WA', module: 'WA' });
        pushRecent(ev, msg);
        if (ev.type === 'wa.post') {
          try {
            await require('./waBlastTracker').handlePostEvent(ev);
          } catch {
            /* ignore */
          }
        }
        await maybeTelegram(ev, msg, level);
      }
    } catch {
      /* ignore */
    }
  };

  const timer = setInterval(() => {
    poll().catch(() => {});
  }, 1200);
  if (timer.unref) timer.unref();
  started = true;

  return {
    stop: () => {
      if (started) clearInterval(timer);
      started = false;
    },
    getRecentEvents: (sinceMs = 3600000) => {
      const cutoff = Date.now() - sinceMs;
      return recentEvents.filter((e) => new Date(e.at).getTime() >= cutoff);
    },
  };
}

module.exports = { startZeroDivuLogBridge, formatEvent };
