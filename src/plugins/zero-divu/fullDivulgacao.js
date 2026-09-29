'use strict';

const { isZeroDivuEnabled } = require('./config');
const { syncHanorkCatalogToZero } = require('./hanorkAutoSync');
const { getZeroDivuClient } = require('./ZeroDivuClient');
const { sendWaCommand } = require('./waIpcHelper');

/**
 * Prepara TG + WA para divulgação completa (catálogo, campanha Hanork, posts ligados).
 * @param {object} deps
 * @param {object} [opts]
 * @param {boolean} [opts.ensureWaReady=true] — liga campanha hanork, auto-sync e resume posts
 */
async function prepareFullDivulgacao(deps = {}, opts = {}) {
  const ensureWaReady = opts.ensureWaReady !== false;
  const out = { waCatalog: null, waOnline: false, errors: [], waPrepared: false };

  if (!isZeroDivuEnabled()) return out;

  const client = getZeroDivuClient();
  const adminId = deps.CONFIG?.ID_DONO?.[0] ?? null;

  try {
    const ping = await sendWaCommand(client, 'wa.ping', {}, adminId);
    out.waOnline = Boolean(ping?.ok);
    if (!ping?.ok) out.errors.push(ping?.message || 'worker_offline');
  } catch (e) {
    out.errors.push(e.message);
  }

  if (out.waOnline && ensureWaReady) {
    const steps = [
      ['wa.set_hanork_campaign', { on: 'on' }],
      ['wa.set_hanork_auto_sync', { on: 'on' }],
      ['wa.resume', {}],
    ];
    let allOk = true;
    for (const [cmd, args] of steps) {
      const ack = await sendWaCommand(client, cmd, args, adminId);
      if (!ack?.ok) {
        allOk = false;
        out.errors.push(`${cmd}: ${ack?.message || ack?.error || 'falha'}`);
      }
    }
    out.waPrepared = allOk;
  }

  try {
    out.waCatalog = await syncHanorkCatalogToZero(deps);
    if (!out.waCatalog?.ok && out.waCatalog?.error) {
      out.errors.push(String(out.waCatalog.error));
    }
  } catch (e) {
    out.errors.push(e.message);
  }

  return out;
}

/**
 * Ciclo completo: PV + grupos + canais + ponte MTProto (+ WA via hanorkAutoSync após sucesso).
 */
async function runFullDivulgacaoCycle(deps, source = 'manual', opts = {}) {
  await prepareFullDivulgacao(deps, opts);
  if (!deps.autoBroadcastService?.runCycle) {
    return { success: false, error: 'auto_broadcast_unavailable' };
  }
  return deps.autoBroadcastService.runCycle(source);
}

function isDivulgacaoBusy(deps) {
  return Boolean(
    deps.broadcastService?.isRunning ||
    deps.autoBroadcastService?.isCycleRunning?.()
  );
}

function busyAlertMessage() {
  return ' Aguarde a divulgação em andamento.';
}

/** @returns {boolean} true se bloqueou (ocupado) */
function guardDivulgacaoBusy(ctx, deps) {
  if (!isDivulgacaoBusy(deps)) return false;
  ctx.answerCbQuery?.(busyAlertMessage(), { show_alert: true }).catch(() => {});
  return true;
}

module.exports = {
  prepareFullDivulgacao,
  runFullDivulgacaoCycle,
  isDivulgacaoBusy,
  busyAlertMessage,
  guardDivulgacaoBusy,
};
