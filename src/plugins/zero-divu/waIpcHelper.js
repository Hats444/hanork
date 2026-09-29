'use strict';

const OFFLINE_MSG =
  'WhatsApp sem resposta no IPC. Confirme que o bot está rodando com <code>ZERO_DIVU_ENABLED=true</code>.';

function offlineMessage(ack) {
  return ack?.message || OFFLINE_MSG;
}

function isWorkerOnline(client) {
  if (!client?.isWorkerLikelyOnline) return false;
  return client.isWorkerLikelyOnline();
}

async function sendWaCommand(client, cmd, args = {}, adminId = null, opts = {}) {
  const { requireOnline = false, timeoutMs } = opts;
  if (requireOnline && !isWorkerOnline(client)) {
    return { ok: false, error: 'worker_offline', message: OFFLINE_MSG };
  }
  const cmdOpts = timeoutMs != null ? { timeoutMs } : {};
  return client.sendCommand(cmd, args, adminId, cmdOpts);
}

/** Comando mutante — exige worker online antes de enfileirar IPC. */
function mutateWa(client, cmd, args, adminId, opts = {}) {
  return sendWaCommand(client, cmd, args, adminId, { requireOnline: true, ...opts });
}

const PANEL_IPC_TIMEOUT_MS = Number(process.env.WA_PANEL_IPC_TIMEOUT_MS) || 8000;
const PANEL_EDIT_TIMEOUT_MS = Number(process.env.WA_PANEL_EDIT_TIMEOUT_MS) || 12000;

function withTimeout(promise, ms, fallback = null) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

/** Edição de painel admin com fallback para reply se Telegram/IPC travar. */
async function safeEditAdminPanel(ctx, editAdminPanel, Msg, text, keyboard, logger, label = 'wa-panel') {
  const replyFallback = async () => {
    const km = keyboard?.reply_markup ? keyboard : { reply_markup: keyboard };
    await Msg.reply(ctx, text, { parse_mode: 'HTML', ...km }).catch(() => {});
  };
  if (!editAdminPanel) {
    await replyFallback();
    return;
  }
  const r = await withTimeout(editAdminPanel(ctx, text, keyboard), PANEL_EDIT_TIMEOUT_MS, 'timeout');
  if (r === 'timeout') {
    logger.warn(`[WA panel:${label}] edit timeout (${PANEL_EDIT_TIMEOUT_MS}ms) — reply fallback`);
    await replyFallback();
  }
}

function formatLimitsText(r, { offline = false } = {}) {
  if (offline || !r || (!r.profile && r.maxGroups == null && r.postDelayMin == null)) {
    return ` <b>Worker WhatsApp indisponível</b>\n\n${OFFLINE_MSG}`;
  }
  const effJ = r.maxJoinsEffective ?? r.maxJoinPerHourEffective ?? r.maxJoinPerHour;
  return (
    ' <b>Limites WhatsApp</b>\n\n' +
    `Perfil: <code>${r.profile || '?'}</code>\n` +
    `Auto-profile: <code>${r.autoProfile ? 'ON' : 'OFF'}</code>\n` +
    (r.autoProfile && r.profile === 'safe' && r.autoUpgradeStreak != null
      ? `Auto → balanced: <code>${r.autoUpgradeStreak}/${r.autoUpgradeNeed ?? 4}</code>\n`
      : '') +
    `Min membros: <code>${r.minMembers ?? '?'}</code>\n` +
    `Auto-join: <code>${r.autoJoinGroups ? 'ON' : 'OFF'}</code>\n` +
    `Entradas/h: <code>${r.joinsThisHour ?? 0}/${effJ ?? '?'}</code> (config ${r.maxJoinPerHour ?? '?'})\n` +
    `Max grupos: <code>${r.maxGroups ?? '?'}</code>\n` +
    `Delay post: <code>${r.postDelayMin ?? '?'}</code>–<code>${r.postDelayMax ?? '?'}</code> ms\n` +
    `Delay join: <code>${r.joinDelayMin ?? '?'}</code>–<code>${r.joinDelayMax ?? '?'}</code> ms\n` +
    `Fila join: <code>${r.joinQueuePersist ?? r.joinQueue ?? 0}</code>\n` +
    `Convites disco: <code>${r.pendingInvitesDisk ?? 0}</code>\n` +
    (r.riskPause ? `Anti-ban: <code>${r.riskPause}</code> ~${r.riskPauseMin} min\n` : '') +
    `Fila promo: <code>${r.promoQueue ?? 0}</code>\n` +
    `Campanha hanork: <code>${r.hanorkCampaignEnabled !== false ? 'ON' : 'OFF'}</code>\n` +
    `Auto-sync catálogo: <code>${r.hanorkAutoSyncEnabled !== false ? 'ON' : 'OFF'}</code>\n` +
    `Posts pausados: <code>${r.postsPaused ? 'sim' : 'não'}</code>`
  );
}

function createRunWa({ guard, Msg, logger, deferBackground, client }) {
  return (label, fn) =>
    async (ctx) => {
      if (!guard(ctx)) return;
      logger.info(`comando ${label}`, { module: 'WA', category: 'HANORK', adminId: ctx.from.id });
      deferBackground(`wa-${label}`, async () => {
        try {
          await fn(ctx);
        } catch (err) {
          logger.error(`[WA cmd:${label}] ${err?.message || err}`);
          try {
            await Msg.reply(ctx, ` <b>${label}</b>: ${err?.message || 'erro interno'}`, {
              parse_mode: 'HTML',
            });
          } catch {
            /* ignore */
          }
        }
      });
    };
}

/** Retorna true se respondeu offline (caller deve return). */
async function replyIfAckFailed(Msg, ctx, ack, prefix = '') {
  if (ack?.ok) return false;
  await Msg.reply(ctx, `${prefix} ${offlineMessage(ack)}`, { parse_mode: 'HTML' });
  return true;
}

async function refreshWorkerState(client, adminId = null) {
  const ack = await client.sendCommand('wa.get_status', {}, adminId);
  const state = client.readState();
  const stale = !ack?.ok && !isWorkerOnline(client);
  return { ack, state, stale };
}

function staleStateBanner(stale) {
  return stale ? '\n\n<i>Dados podem estar desatualizados — reconectando.</i>' : '';
}

function enrichStateWithHealth(state, health) {
  const s = state && typeof state === 'object' ? { ...state } : {};
  if (!health) return s;
  const reconnecting =
    Boolean(health.reconnecting) ||
    (health.hasCreds && health.workerAlive && !health.connected);
  if (reconnecting) s._reconnecting = true;
  if (!health.workerAlive) {
    s.connected = false;
    s.ipcOnline = false;
  }
  return s;
}

async function refreshWorkerStateQuick(client, adminId, timeoutMs = 5000) {
  const ack = await client
    .sendCommand('wa.get_status', {}, adminId, { timeoutMs })
    .catch(() => ({ ok: false }));
  const state = client.readState();
  const stale = !ack?.ok && !isWorkerOnline(client);
  return { ack, state, stale };
}

function ensureAdminWaOnMenuOpen(adminId) {
  try {
    const { deferBackground } = require('../../utils/defer');
    deferBackground('wa-admin-menu-ensure', async () => {
      const { ensureBothAdminWorkers } = require('./spawnZeroWorker');
      await ensureBothAdminWorkers(adminId, 8000).catch(() => null);
    });
  } catch {
    /* ignore */
  }
}

function ensureAdminWaReady(adminId) {
  return ensureAdminWaOnMenuOpen(adminId);
}

module.exports = {
  OFFLINE_MSG,
  offlineMessage,
  isWorkerOnline,
  sendWaCommand,
  mutateWa,
  formatLimitsText,
  createRunWa,
  replyIfAckFailed,
  refreshWorkerState,
  refreshWorkerStateQuick,
  staleStateBanner,
  enrichStateWithHealth,
  ensureAdminWaOnMenuOpen,
  ensureAdminWaReady,
  PANEL_IPC_TIMEOUT_MS,
  PANEL_EDIT_TIMEOUT_MS,
  withTimeout,
  safeEditAdminPanel,
};
