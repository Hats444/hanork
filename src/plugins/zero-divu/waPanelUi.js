'use strict';

const { isDualWaEnabled, resolveSession, DEFAULT_PRIMARY, DEFAULT_SECONDARY } = require('./waSessionsManifest');

function phoneShort(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (d.length <= 8) return d || '—';
  return `…${d.slice(-4)}`;
}

function lastPostShort(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

function connDot(connected) {
  return connected ? '🟢' : '🔴';
}

/** Uma linha-resumo por número (painel principal). */
function formatSessionLineCompact(state, label) {
  if (!state) {
    return `${connDot(false)} <b>${label}</b> · sem dados`;
  }
  const maxG = state.maxGroupsEffective ?? state.maxGroups ?? '?';
  const gp = `${state.activeGroups ?? 0}/${maxG}`;
  const phone = state.phone ? `<code>${phoneShort(state.phone)}</code>` : '—';
  const paused = state.postsPaused || state.paused ? ' · ⏸' : '';
  return `${connDot(state.connected)} <b>${label}</b> · ${phone} · <b>${gp}</b> GP${paused}`;
}

/** Detalhe expandido (tela 📊 Detalhes). */
function formatSessionChip(state, label) {
  if (!state) {
    return `<b>${label}</b> ${connDot(false)} · sem dados`;
  }
  const maxG = state.maxGroupsEffective ?? state.maxGroups ?? '?';
  const groups = `${state.activeGroups ?? 0}/${maxG}`;
  const phone = state.phone ? `<code>${phoneShort(state.phone)}</code>` : '—';
  const paused = state.postsPaused || state.paused ? ' · ⏸' : '';
  const profile = state.profile || 'safe';
  const risk = state.spamRiskScore != null ? ` · risco ${state.spamRiskScore}` : '';
  const joins =
    state.joinsThisHour != null
      ? ` · entradas ${state.joinsThisHour}/${state.maxJoinsEffective ?? state.maxJoinPerHour ?? '?'}`
      : '';
  const post = state.lastPostAt ? ` · post ${lastPostShort(state.lastPostAt)}` : '';

  let extra = '';
  if (state.riskPause) {
    extra = `\n   🛡 ${state.riskPause}${state.riskPauseMin ? ` ~${state.riskPauseMin}m` : ''}${
      state.riskThrottle != null && state.riskThrottle < 1
        ? ` · ${Math.round(state.riskThrottle * 100)}%`
        : ''
    }`;
  } else if (state.promoQueue > 0) {
    extra = `\n   🛍 fila promo: ${state.promoQueue}`;
  }

  return (
    `<b>${label}</b> ${connDot(state.connected)} ${phone} · <b>${groups}</b> GP` +
    `\n   ${profile}${risk}${joins}${post}${paused}${extra}`
  );
}

function getOverviewPackFromCache(primaryClient = null, primaryState = null) {
  const client = primaryClient || require('./ZeroDivuClient').getZeroDivuClient();
  const labelA = resolveSession(DEFAULT_PRIMARY).displayName;
  const labelB = resolveSession(DEFAULT_SECONDARY).displayName;
  const a = primaryState || client.readState() || {};

  if (!isDualWaEnabled()) {
    return { dual: false, primary: a, labelA };
  }

  const clientB = require('./ZeroDivuClient').getZeroDivuClient(DEFAULT_SECONDARY);
  const b = clientB.readState() || {};
  return { dual: true, primary: a, secondary: b, labelA, labelB };
}

function normalizeOverviewPack(pack) {
  const labelA = pack.labelA || resolveSession(DEFAULT_PRIMARY).displayName;
  const labelB = pack.labelB || resolveSession(DEFAULT_SECONDARY).displayName;
  return {
    ...pack,
    labelA,
    labelB,
    dual: pack.dual !== undefined ? pack.dual : isDualWaEnabled(),
  };
}

function resolveOverviewPack(arg1, arg2) {
  if (arg1 && (arg1.primary !== undefined || arg1.dual !== undefined)) {
    return normalizeOverviewPack(arg1);
  }
  const state = arg2 ?? (arg1 && typeof arg1 === 'object' && !arg1.reply_markup ? arg1 : null);
  return getOverviewPackFromCache(null, state);
}

/** Visão unificada WA 1 + WA 2 (ou só um). */
function buildWaOverviewText(states = {}, opts = {}) {
  const detail = opts.detail === true;
  const pack = normalizeOverviewPack(states);
  const a = pack.primary || null;
  const b = pack.secondary || null;
  const dual = Boolean(pack.dual && b);
  const labelA = pack.labelA;
  const labelB = pack.labelB;

  const totalGroups = (a?.activeGroups ?? 0) + (dual ? b?.activeGroups ?? 0 : 0);
  const connectedCount =
    (a?.connected ? 1 : 0) + (dual && b?.connected ? 1 : 0);

  const lines = [];
  lines.push(`📱 <b>WhatsApp</b>`);
  lines.push(
    dual
      ? `👥 <b>${totalGroups}</b> grupos · <b>${connectedCount}/2</b> online`
      : `👥 <b>${totalGroups}</b> grupos · ${connDot(a?.connected)} ${a?.connected ? 'online' : 'offline'}`
  );

  const anyPaused = a?.postsPaused || a?.paused || b?.postsPaused || b?.paused;
  const promoTotal = (Number(a?.promoQueue) || 0) + (dual ? Number(b?.promoQueue) || 0 : 0);
  const flags = [];
  if (anyPaused) flags.push('⏸ posts pausados');
  if (a?.hanorkCampaignEnabled === false) flags.push('Hanork OFF');
  if (promoTotal > 0) flags.push(`promo ${promoTotal}`);
  if (flags.length) lines.push(`<i>${flags.join(' · ')}</i>`);

  lines.push('');
  if (detail) {
    lines.push(formatSessionChip(a, labelA));
    if (dual) lines.push(formatSessionChip(b, labelB));
  } else {
    lines.push(formatSessionLineCompact(a, labelA));
    if (dual) lines.push(formatSessionLineCompact(b, labelB));
  }

  const riskA = a?.riskPause;
  const riskB = dual ? b?.riskPause : null;
  if (riskA || riskB) {
    const kind = riskA || riskB;
    const mins = Math.max(a?.riskPauseMin ?? 0, dual ? b?.riskPauseMin ?? 0 : 0);
    const throttle = Math.min(
      a?.riskThrottle != null && a.riskThrottle < 1 ? a.riskThrottle : 1,
      dual && b?.riskThrottle != null && b.riskThrottle < 1 ? b.riskThrottle : 1
    );
    let riskLine = `🛡 Anti-ban <b>${kind}</b>`;
    if (mins > 0) riskLine += ` · ~${mins} min`;
    if (throttle < 1) riskLine += ` · ${Math.round(throttle * 100)}%`;
    lines.push(riskLine);
  }

  const linksA = a?.inviteCatalogJoinable;
  const linksT = a?.inviteCatalogTotal;
  if (linksT != null) {
    lines.push(`🔗 Convites <b>${linksA ?? '?'}</b> / ${linksT}`);
  }

  if (detail) {
    lines.push('\n<i>Stats por grupo:</i> <code>/wa_status_stats</code>');
  }

  return lines.join('\n');
}

async function fetchOverviewStates(adminId, primaryClient, secondaryClient = null) {
  const { refreshWorkerStateQuick, isWorkerOnline } = require('./waIpcHelper');
  const labelA = resolveSession(DEFAULT_PRIMARY).displayName;
  const labelB = resolveSession(DEFAULT_SECONDARY).displayName;

  if (!isDualWaEnabled()) {
    const { state } = await refreshWorkerStateQuick(primaryClient, adminId, 2500);
    return {
      dual: false,
      primary: state || primaryClient.readState() || {},
      labelA,
    };
  }

  const clientB = secondaryClient || require('./ZeroDivuClient').getZeroDivuClient(DEFAULT_SECONDARY);
  const [ra, rb] = await Promise.all([
    refreshWorkerStateQuick(primaryClient, adminId, 2500),
    refreshWorkerStateQuick(clientB, adminId, 2500),
  ]);

  return {
    dual: true,
    primary: ra.state || primaryClient.readState() || {},
    secondary: rb.state || clientB.readState() || {},
    staleA: ra.stale,
    staleB: rb.stale,
    labelA,
    labelB,
  };
}

function buildOverviewFromCached(primaryClient, secondaryClient = null) {
  return buildWaOverviewText(getOverviewPackFromCache(primaryClient, null));
}

function sectionRow(label) {
  const text = `── ${label} ──`;
  return [{ text: text.length > 64 ? text.slice(0, 64) : text, callback_data: 'noop' }];
}

function sessionStatusButton(state, label, connectCb) {
  const dot = state?.connected ? '🟢' : '🔴';
  const phone = state?.phone ? phoneShort(state.phone) : '—';
  const maxG = state?.maxGroupsEffective ?? state?.maxGroups ?? '?';
  const gp = `${state?.activeGroups ?? 0}/${maxG}`;
  const pause = state?.postsPaused || state?.paused ? ' ⏸' : '';
  let text = `${dot} ${label} · ${phone} · ${gp}${pause}`;
  if (text.length > 64) {
    text = `${dot} ${label} · ${gp}${pause}`.slice(0, 64);
  }
  return { text, callback_data: connectCb };
}

function prebuiltKeyboard(inline_keyboard) {
  return {
    __hanorkPrebuilt: true,
    reply_markup: {
      __hanorkPrebuilt: true,
      inline_keyboard,
    },
  };
}

function buildWaPanelKeyboard(arg1, arg2) {
  const pack = resolveOverviewPack(arg1, arg2);
  const a = pack.primary || {};
  const b = pack.secondary || null;
  const dual = Boolean(pack.dual && b != null);
  const labelA = pack.labelA;
  const labelB = pack.labelB;

  const paused = dual
    ? Boolean(a.postsPaused || a.paused || b?.postsPaused || b?.paused)
    : Boolean(a.postsPaused || a.paused);
  const promoN = (Number(a.promoQueue) || 0) + (dual ? Number(b?.promoQueue) || 0 : 0);

  const rows = [];

  if (dual) {
    rows.push([
      sessionStatusButton(a, labelA, 'a_wa_connect'),
      sessionStatusButton(b, labelB, 'a_wa2_connect'),
    ]);
  } else {
    rows.push([
      sessionStatusButton(a, labelA, 'a_wa_connect'),
      { text: '📊 Detalhes', callback_data: 'a_wa_status' },
    ]);
  }

  rows.push(sectionRow('Ações rápidas'));
  rows.push([
    {
      text: paused ? '▶️ Ligar posts' : '⏸ Pausar posts',
      callback_data: paused ? 'a_wa_resume' : 'a_wa_pause',
    },
    { text: '📤 Postar agora', callback_data: 'a_wa_post' },
  ]);

  rows.push(sectionRow('Divulgação'));
  rows.push([
    { text: '📢 Blast custom', callback_data: 'a_wa_custom_blast' },
    { text: promoN ? `🛍 Promo (${promoN})` : '🛍 Fila promo', callback_data: 'a_wa_promo_fila' },
  ]);

  rows.push(sectionRow('Grupos & sync'));
  rows.push([
    { text: '👥 Grupos', callback_data: 'a_wa_groups' },
    { text: '🔄 Sync GP', callback_data: 'a_wa_sync_groups' },
  ]);

  if (dual) {
    rows.push([
      { text: '📊 Detalhes WA', callback_data: 'a_wa_status' },
      { text: '🧰 Limites', callback_data: 'a_wa_limits' },
    ]);
  }

  rows.push(sectionRow('Mais'));
  rows.push([
    { text: '🖼 Divulgação', callback_data: 'a_divulgacao_menu' },
    { text: '⚙️ Config', callback_data: 'a_wa_config_menu' },
  ]);
  rows.push([{ text: '📖 Ajuda WA', callback_data: 'a_wa_help' }]);

  rows.push([{ text: '🔄 Atualizar painel', callback_data: 'a_wa_menu' }]);
  rows.push([{ text: '🔙 Painel Admin', callback_data: 'a_menu' }]);

  return prebuiltKeyboard(rows);
}

function buildWaConfigKeyboard(Markup, state = {}) {
  const { toTwoCols } = require('../../telegram/menus/twoColKeyboard');
  const s = state || {};
  const hanorkOn = s.hanorkCampaignEnabled !== false;
  const autoSyncOn = s.hanorkAutoSyncEnabled !== false;
  const autoJoin = s.autoJoinGroups !== false;
  const autoPost = s.autoPostOnJoin !== false;

  return Markup.inlineKeyboard(
    toTwoCols([
      [
        { text: '🧰 Limites', callback_data: 'a_wa_limits' },
        { text: '📈 Stats/dia', callback_data: 'a_wa_status_stats' },
      ],
      [
        { text: hanorkOn ? '🛍 Hanork ON' : '🛍 Hanork OFF', callback_data: 'a_wa_hanork_toggle' },
        { text: autoSyncOn ? '🔄 Sync ON' : '🔄 Sync OFF', callback_data: 'a_wa_autosync_toggle' },
      ],
      [
        { text: autoJoin ? '✅ Auto-join' : '❌ Auto-join', callback_data: 'a_wa_autojoin_toggle' },
        { text: autoPost ? '✅ Post entrar' : '❌ Post entrar', callback_data: 'a_wa_autopost_toggle' },
      ],
      [
        { text: '🛡 Preset PROD', callback_data: 'a_wa_preset_prod' },
        { text: '📝 Campanhas', callback_data: 'a_wa_campaigns' },
      ],
      [
        { text: '🔄 Catálogo', callback_data: 'a_wa_sync_catalog' },
        { text: '📋 Logs', callback_data: 'a_wa_logs' },
      ],
      [
        { text: '🔢 Pair WA 1', callback_data: 'a_wa_connect_pair' },
        ...(isDualWaEnabled()
          ? [{ text: '🔢 Pair WA 2', callback_data: 'a_wa2_connect_pair' }]
          : [{ text: '⚖️ Balanced', callback_data: 'a_wa_perfil_balanced' }]),
      ],
      [{ text: '🔙 Painel WA', callback_data: 'a_wa_menu' }],
    ])
  );
}

function configMenuHint() {
  return '⚙️ <b>Configuração WhatsApp</b>\n\n<i>Limites, toggles e ferramentas avançadas.</i>';
}

module.exports = {
  phoneShort,
  lastPostShort,
  formatSessionLineCompact,
  formatSessionChip,
  buildWaOverviewText,
  buildOverviewFromCached,
  getOverviewPackFromCache,
  fetchOverviewStates,
  buildWaPanelKeyboard,
  buildWaConfigKeyboard,
  configMenuHint,
};
