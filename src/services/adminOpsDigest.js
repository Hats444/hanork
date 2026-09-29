'use strict';

const { connect } = require('../config/database-sqlite');

const KV_KEY = 'admin_ops_digest';

const LABELS = {
  order_monitor: '📦 Order monitor',
  catalog_sync: '🔄 Catalog sync',
  refill: '♻️ Refill',
  service_health: '💊 Service health',
  balance: '💰 Balance SMM',
  stock_reconcile: '📊 Stock Virtuo',
};

function loadAll() {
  try {
    const row = connect().prepare('SELECT value FROM kv_store WHERE key = ?').get(KV_KEY);
    if (!row?.value) return {};
    return JSON.parse(row.value);
  } catch {
    return {};
  }
}

function saveAll(data) {
  connect()
    .prepare(`INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, datetime('now'))`)
    .run(KV_KEY, JSON.stringify(data));
}

function formatAge(iso) {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60000) return 'agora';
  if (ms < 3600000) return `${Math.round(ms / 60000)} min`;
  if (ms < 86400000) return `${Math.round(ms / 3600000)} h`;
  return `${Math.round(ms / 86400000)} d`;
}

function summarize(key, result) {
  if (!result || result.skipped) return '⏭ ciclo anterior em andamento';
  switch (key) {
    case 'order_monitor':
      return `${result.checked ?? 0} verificado(s) · ${result.updated ?? 0} atualizado(s) · ${result.notified ?? 0} aviso(s)`;
    case 'catalog_sync':
      if (result.ok === false) return `❌ ${result.error || 'falhou'}`;
      return `${result.total_processed ?? result.processed ?? 0} proc · +${result.created_count ?? result.created ?? 0} · ~${result.updated_count ?? result.updated ?? 0}`;
    case 'refill':
      return `${result.checked ?? 0} verificado(s) · ${result.refilled ?? result.updated ?? 0} refill(s)`;
    case 'service_health':
      return `${result.checked ?? 0} serviço(s) · ${result.deactivated ?? 0} desativado(s)`;
    case 'balance':
      if (result.balance != null) {
        const lvl = result.level || 'ok';
        const icon = lvl === 'critical' ? '🔴' : lvl === 'warn' ? '🟡' : '🟢';
        return `${icon} R$ ${Number(result.balance).toFixed(2)} · ${lvl}`;
      }
      return result.notified ? 'alerta enviado' : 'ok';
    case 'stock_reconcile':
      return `${result.checked ?? 0} checado(s) · +${result.activated ?? 0} · −${result.deactivated ?? 0} · ${result.sellable ?? '?'}/${result.total ?? '?'} vendável`;
    default:
      return JSON.stringify(result).slice(0, 80);
  }
}

function isNotable(key, result) {
  if (!result || result.skipped) return false;
  switch (key) {
    case 'order_monitor':
      return (result.updated ?? 0) > 0 || (result.notified ?? 0) > 0;
    case 'catalog_sync':
      return result.ok === false;
    case 'refill':
      return (result.refilled ?? result.updated ?? 0) > 0;
    case 'service_health':
      return (result.deactivated ?? 0) > 0;
    case 'balance':
      return result.level === 'warn' || result.level === 'critical' || result.notified;
    case 'stock_reconcile':
      return (result.deactivated ?? 0) > 0;
    default:
      return false;
  }
}

function record(key, result) {
  const all = loadAll();
  all[key] = {
    at: new Date().toISOString(),
    result: result || {},
    summary: summarize(key, result),
  };
  saveAll(all);
  return { notable: isNotable(key, result), entry: all[key] };
}

function buildPanelText() {
  const all = loadAll();
  const lines = Object.keys(LABELS).map((key) => {
    const entry = all[key];
    const label = LABELS[key];
    if (!entry) return `${label}\n<i>Sem dados ainda</i>`;
    return `${label} · <i>${formatAge(entry.at)}</i>\n${entry.summary}`;
  });
  return (
    '🛠 <b>Status operacional</b>\n\n' +
    lines.join('\n\n') +
    '\n\n<i>Atualizado pelos crons SMM + Virtuo.</i>'
  );
}

module.exports = {
  record,
  buildPanelText,
  LABELS,
  isNotable,
  summarize,
};
