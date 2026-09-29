'use strict';

const runtimeBridge = require('./runtimeBridge');
const runtimeControls = require('./runtimeControls');
const configApplier = require('./configApplier');
const eventBus = require('./eventBus');
const { writeStateSnapshot } = require('./stateWriter');

function getSock() {
  try {
    return require('../services/socketRegistry').get() || runtimeBridge.getSock?.();
  } catch {
    return runtimeBridge.getSock?.() || null;
  }
}

function resolveGroupJid(query) {
  const groupValidator = require('../services/groupValidator');
  const q = String(query || '').trim();
  if (!q) return null;
  if (q.includes('@g.us')) return q;

  const active = groupValidator.loadActiveGroups();
  if (active[q]) return q;

  const digits = q.replace(/\D/g, '');
  for (const [jid, g] of Object.entries(active)) {
    const short = jid.split('@')[0];
    if (short === digits || short.endsWith(digits)) return jid;
    if ((g.subject || '').toLowerCase().includes(q.toLowerCase())) return jid;
  }
  return null;
}

function joinQueuePending() {
  try {
    const jobs = require('../services/persistentQueue').list('join') || [];
    return jobs.filter((j) => j.status === 'pending' || j.status === 'processing').length;
  } catch {
    return 0;
  }
}

exports.pausePosts = async () => {
  runtimeControls.setPostsPaused(true);
  await writeStateSnapshot({ postsPaused: true });
  return { paused: true };
};

exports.resumePosts = async () => {
  runtimeControls.setPostsPaused(false);
  await writeStateSnapshot({ postsPaused: false });
  return { paused: false };
};

exports.runPostNow = async (args = {}) => {
  const sock = getSock();
  if (!sock?.user) {
    return { ok: false, error: 'not_connected', message: 'WhatsApp não conectado' };
  }

  const postEligibility = require('../utils/postEligibility');
  let promoTried = null;

  if (args.promo !== false) {
    try {
      const promo = await require('./promoQueue').processNextIfAny(sock);
      if (promo.processed && promo.sent > 0) {
        await writeStateSnapshot();
        return {
          ok: true,
          sent: promo.sent,
          total: promo.sent,
          promo: true,
          jobId: promo.jobId,
          productName: promo.productName,
        };
      }
      if (promo.processed) {
        promoTried = promo;
      }
    } catch (e) {
      return { ok: false, error: 'promo_failed', message: e?.message || String(e) };
    }
  }

  const grupos = require('../services/grupos');
  const postagem = require('../services/postagem');
  let ids = grupos.getEligibleGroupIds();
  if (!ids.length) {
    const summary = postEligibility.summarizeActive();
    const message = postEligibility.buildBlockedMessage(summary, {
      context: args.campaign ? `campanha ${args.campaign}` : 'postar',
    });
    return {
      ok: false,
      error: 'no_groups',
      message,
      detail: summary,
      promoTried: promoTried
        ? { productName: promoTried.productName, sent: 0, noGroups: Boolean(promoTried.noGroups) }
        : null,
    };
  }

  const opts = {
    source: 'manual',
    skipQueue: true,
    forceAdmin: true,
  };
  if (args.campaign) opts.campaign = String(args.campaign).toLowerCase();

  const sent = await postagem.runPostCycle(sock, ids, opts);
  await writeStateSnapshot();

  const out = {
    ok: true,
    sent,
    total: ids.length,
    campaign: opts.campaign || null,
  };

  if (promoTried) {
    out.promoTried = {
      productName: promoTried.productName,
      sent: promoTried.sent || 0,
      noGroups: Boolean(promoTried.noGroups),
      allSkipped: Boolean(promoTried.allSkipped),
    };
  }

  if (sent === 0) {
    const summary = postEligibility.summarizeIds(ids);
    out.detail = summary;
    out.message = postEligibility.buildZeroSendMessage(summary, ids.length);
    if (promoTried?.productName) {
      out.message =
        `<i>Promo na fila (${promoTried.productName}) sem envio — tentando status normal.</i>\n\n` +
        out.message;
    }
  } else if (promoTried?.productName) {
    out.message = `<i>Fila promo sem envio (${promoTried.productName}).</i> Status: <b>${sent}/${ids.length}</b>.`;
  }

  return out;
};

exports.processPromoQueue = async () => {
  try {
    return await require('./promoQueue').processNow();
  } catch (e) {
    return { ok: false, error: 'promo_failed', message: e?.message || String(e) };
  }
};

async function startBlast(sock, args, { custom = false } = {}) {
  const blastCoordinator = require('../services/blastCoordinator');
  const mod = custom ? require('../services/customBlast') : require('../services/divBlast');
  blastCoordinator.recoverStaleBlastLocks();
  mod.forceReset?.();

  const groupIds = Array.isArray(args.groupIds) ? args.groupIds.filter(Boolean) : [];
  if (groupIds.length > 1 && args.force === false) {
    return {
      ok: false,
      error: 'force_required',
      message: 'Campanha multi-grupo exige force:true no worker',
    };
  }

  let out = mod.startBackground(sock, args);
  if (!out.ok && (out.error === 'busy' || out.error === 'blast_busy')) {
    blastCoordinator.recoverStaleBlastLocks();
    mod.forceReset?.();
    out = mod.startBackground(sock, args);
  }
  if (!out.ok) {
    return {
      ok: false,
      error: out.error || 'busy',
      message: out.message || 'Outro disparo já em andamento',
    };
  }
  await writeStateSnapshot();
  return { ok: true, result: out };
}

exports.runCustomBlast = async (args = {}) => {
  const sock = getSock();
  if (!sock?.user) {
    return { ok: false, error: 'not_connected', message: 'WhatsApp não conectado' };
  }
  const text = String(args.text || '').trim();
  if (!text && !args.stagingName && !args.imagePath) {
    return { ok: false, error: 'empty_content', message: 'Texto ou mídia obrigatório' };
  }
  if (args.stagingName) {
    const fs = require('fs');
    const path = require('path');
    const { IPC_DIR } = require('./paths');
    const inboxPath = path.join(IPC_DIR, 'inbox', path.basename(String(args.stagingName)));
    if (!fs.existsSync(inboxPath)) {
      return {
        ok: false,
        error: 'staging_missing',
        message: 'Mídia não encontrada no worker — reenvie na campanha',
      };
    }
  }
  const blastArgs = { force: true, ...args };
  return startBlast(sock, blastArgs, { custom: true });
};

exports.runDivBlast = async (args = {}) => {
  const sock = getSock();
  if (!sock?.user) {
    return { ok: false, error: 'not_connected', message: 'WhatsApp não conectado' };
  }
  const text = String(args.text || '').trim();
  if (!text) {
    return { ok: false, error: 'empty_content', message: 'Texto obrigatório' };
  }
  const blastArgs = { force: true, ...args };
  return startBlast(sock, blastArgs, { custom: false });
};

exports.recoverBlastLocks = () => require('../services/blastCoordinator').recoverStaleBlastLocks();

exports.reconnectSession = async () => {
  try {
    const out = await require('./runtimeBridge').requestReconnectSession();
    if (!out?.ok) return out || { ok: false, error: 'reconnect_failed' };
    return { ok: true, result: out };
  } catch (e) {
    return { ok: false, error: 'reconnect_failed', message: e?.message || String(e) };
  }
};

exports.enqueuePromo = (opts) => require('./promoQueue').enqueuePromo(opts);

exports.listPromoQueue = () => require('./promoQueue').listPending();

exports.setHanorkAutoSync = (enabled) => {
  const on = require('./runtimeSettings').setHanorkAutoSyncEnabled(enabled);
  return { hanorkAutoSyncEnabled: on };
};

exports.setHanorkCampaign = (enabled) => {
  const on = require('./runtimeSettings').setHanorkCampaignEnabled(enabled);
  return { hanorkCampaignEnabled: on };
};

exports.getHanorkCampaign = () => ({
  hanorkCampaignEnabled: require('./runtimeSettings').isHanorkCampaignEnabled(),
  hanorkAutoSyncEnabled: require('./runtimeSettings').isHanorkAutoSyncEnabled(),
  hanorkAutoSync: require('./hanorkAutoCatalog').summary(),
});

exports.syncGroups = async () => {
  const sock = getSock();
  if (!sock?.user) {
    return { ok: false, error: 'not_connected' };
  }
  await require('../services/grupos').syncGroupsFromWhatsApp(sock, true);
  const count = require('../services/groupValidator').countActive();
  await writeStateSnapshot({ activeGroups: count });
  return { ok: true, activeGroups: count };
};

exports.runOverlapCleanup = async () => {
  const sock = getSock();
  if (!sock?.user) {
    return { ok: false, error: 'not_connected', message: 'WhatsApp não conectado' };
  }
  const dual = require('../services/dualGroupRegistry');
  if (!dual.dualEnabled()) {
    return {
      ok: false,
      error: 'dual_disabled',
      message: 'Overlap cleanup só no modo dual WA',
    };
  }
  const result = await require('../services/dualOverlapMonitor').runOverlapPass(sock);
  await writeStateSnapshot();
  return { ok: true, ...result };
};

exports.listGroups = (limit = 15) => {
  const list = require('../services/groupValidator').listSortedByScore();
  return list.slice(0, limit).map((g) => ({
    id: g.id,
    shortId: g.id?.split('@')[0],
    subject: g.subject || g.id?.split('@')[0],
    score: g.score ?? 0,
    lastPostAt: g.lastPostAt || null,
    postsOk: g.postsOk || 0,
  }));
};

exports.listInvalidGroups = (limit = 15) => {
  const inv = require('../services/groupValidator').loadInvalidGroups();
  return Object.entries(inv)
    .slice(0, limit)
    .map(([jid, meta]) => ({
      id: jid,
      shortId: jid.split('@')[0],
      reason: meta?.reason || 'unknown',
      at: meta?.at || null,
    }));
};

exports.leaveGroup = async (query) => {
  const sock = getSock();
  if (!sock?.user) {
    return { ok: false, error: 'not_connected' };
  }
  const jid = resolveGroupJid(query);
  if (!jid) {
    return { ok: false, error: 'not_found', message: `Grupo não encontrado: ${query}` };
  }
  const active = require('../services/groupValidator').loadActiveGroups();
  const name = active[jid]?.subject || jid.split('@')[0];
  try {
    await sock.groupLeave(jid);
  } catch (e) {
    return { ok: false, error: 'leave_failed', message: e?.message || String(e) };
  }
  require('../services/groupRegistryCleanup').onBotLeft(jid, 'admin sair (Telegram)', { subject: name });
  await eventBus.emitLeave({ group: name, reason: 'admin Telegram' });
  await writeStateSnapshot();
  return { ok: true, id: jid, subject: name };
};

function applyHighCapacitySafeguards(configured) {
  if (configured < 32) return;
  const cfg = require('../config/divulgacao');
  const patch = {
    MAX_JOIN_PER_HOUR: Math.min(Number(cfg.MAX_JOIN_PER_HOUR) || 3, 2),
    MAX_POSTS_PER_HOUR: Math.min(Number(cfg.MAX_POSTS_PER_HOUR) || 28, 16),
    MAX_GROUPS_PER_CYCLE: Math.min(Number(cfg.MAX_GROUPS_PER_CYCLE) || 6, 4),
  };
  if (!cfg.ACTIVE_HOURS_ENABLED) patch.ACTIVE_HOURS_ENABLED = true;
  if (!cfg.QUIET_HOURS_ENABLED) patch.QUIET_HOURS_ENABLED = true;
  configApplier.applyPatch(patch);
}

exports.setMaxGroups = async (n) => {
  const configured = Math.max(1, Number(n) || 20);
  configApplier.setMaxGroups(configured);
  applyHighCapacitySafeguards(configured);
  await configApplier.persistPatch();
  const operationalLimits = require('../services/operationalLimits');
  const effective = operationalLimits.getMaxGroups();
  await writeStateSnapshot({
    maxGroups: configured,
    maxGroupsEffective: effective,
    maxGroupsPinned: true,
  });
  return {
    maxGroups: configured,
    maxGroupsEffective: effective,
    maxGroupsPinned: true,
  };
};

exports.setProfile = async (name, opts = {}) => {
  const id = configApplier.setProfile(name, { manual: opts.manual !== false });
  await configApplier.persistPatch();
  await writeStateSnapshot({
    profile: id,
    autoProfile: configApplier.isAutoProfileEnabled(),
  });
  return { profile: id, autoProfile: configApplier.isAutoProfileEnabled() };
};

exports.setAutoProfile = async (enabled) => {
  if (enabled) configApplier.enableAutoProfile();
  else configApplier.disableAutoProfile();
  await configApplier.persistPatch();
  let result = { autoProfile: configApplier.isAutoProfileEnabled() };
  if (enabled) {
    const adj = await require('../services/autoProfile').maybeAdjust({ force: true });
    result = { ...result, ...adj };
  } else {
    await writeStateSnapshot({ autoProfile: false });
  }
  return result;
};

exports.setDelay = async (kind, ms) => {
  const val = Math.max(1000, Number(ms) || 10000);
  configApplier.setDelay(kind, val);
  await configApplier.persistPatch();
  await writeStateSnapshot();
  return { kind, ms: val };
};

exports.setMinMembers = async (n) => {
  const min = Math.max(0, Number(n) || 0);
  configApplier.applyPatch({ MIN_MEMBERS_IN_GROUP: min });
  await configApplier.persistPatch();
  await writeStateSnapshot({ minMembers: min });
  return { minMembers: min };
};

exports.setAutoJoin = async (enabled) => {
  const on = enabled === true || enabled === 'on' || enabled === '1';
  configApplier.applyPatch({ AUTO_JOIN_GROUPS: on });
  await configApplier.persistPatch();
  await writeStateSnapshot({ autoJoinGroups: on });
  return { autoJoinGroups: on };
};

exports.setAutoPostOnJoin = async (enabled) => {
  const on = enabled === true || enabled === 'on' || enabled === '1';
  configApplier.applyPatch({ AUTO_POST_ON_JOIN: on });
  await configApplier.persistPatch();
  await writeStateSnapshot({ autoPostOnJoin: on });
  return { autoPostOnJoin: on };
};

exports.setMaxJoinsPerHour = async (n) => {
  const max = Math.max(0, Number(n) || 0);
  configApplier.applyPatch({ MAX_JOIN_PER_HOUR: max });
  await configApplier.persistPatch();
  await writeStateSnapshot({ maxJoinPerHour: max });
  return { maxJoinPerHour: max };
};

exports.enqueueInvite = async ({ code, meta = {} } = {}) => {
  const inviteCode = String(code || '').trim();
  if (!inviteCode) return { ok: false, message: 'missing_code' };
  const joinManager = require('../services/joinManager');
  const socketRegistry = require('../services/socketRegistry');
  const sock =
    (typeof socketRegistry.getSocket === 'function' && socketRegistry.getSocket()) ||
    (typeof socketRegistry.getMainSocket === 'function' && socketRegistry.getMainSocket()) ||
    null;
  if (!sock) return { ok: false, message: 'not_connected' };
  const enqueued = await joinManager.enqueueInvite(sock, inviteCode, {
    ...meta,
    manual: true,
    from: meta.from || 'hanork_div',
  });
  try {
    await require('./eventBus').appendEvent({
      type: 'wa.enqueue_invite',
      code: inviteCode.slice(0, 12),
      manual: true,
    });
  } catch {
    /* ignore */
  }
  return { ok: Boolean(enqueued), enqueued: Boolean(enqueued) };
};

exports.applyProdPreset = async (opts = {}) => {
  const patch = {
    OPERATION_PROFILE: 'safe',
    autoProfileEnabled: false,
    MIN_MEMBERS_IN_GROUP: Number(opts.minMembers || 50) || 50,
    // Produção: crescimento controlado, com filtros (min membros) e limites baixos.
    AUTO_JOIN_GROUPS: true,
    AUTO_POST_ON_JOIN: true,
    MAX_JOIN_PER_HOUR: 2,
    MAX_POSTS_PER_HOUR: 8,
    MAX_GROUPS_PER_CYCLE: 3,
    STARTUP_IMMEDIATE_MAX_GROUPS: 3,
    STARTUP_CATCHUP_BATCH_SIZE: 4,
    STARTUP_CATCHUP_MAX_POSTS: 8,
    STARTUP_CATCHUP_BYPASS_ALL_GRACE: false,
    HANORK_PROMO_MAX_GROUPS: 4,
    JOIN_WELCOME_DELAY_MS_MIN: 45 * 1000,
    JOIN_WELCOME_DELAY_MS_MAX: 90 * 1000,
    ACTIVE_HOURS_ENABLED: true,
    QUIET_HOURS_ENABLED: true,
    // Delays mais humanos (anti padrão repetitivo)
    POST_DELAY_MS: 22000,
    STATUS_DELAY_MS: 90000,
    JOIN_DELAY_MS: 65000,
  };
  configApplier.applyPatch(patch);
  await configApplier.persistPatch();
  await writeStateSnapshot({
    profile: 'safe',
    autoProfile: false,
    minMembers: patch.MIN_MEMBERS_IN_GROUP,
    autoJoinGroups: patch.AUTO_JOIN_GROUPS,
    autoPostOnJoin: patch.AUTO_POST_ON_JOIN,
    maxJoinPerHour: patch.MAX_JOIN_PER_HOUR,
  });
  try {
    await eventBus.appendEvent({ type: 'wa.preset', name: 'prod_safe' });
  } catch {
    /* ignore */
  }
  return { preset: 'prod_safe', applied: patch };
};

exports.getLimitsSummary = () => {
  const cfg = require('../config/divulgacao');
  const operationalLimits = require('../services/operationalLimits');
  let auto = {};
  try {
    auto = require('../services/autoProfile').getStatus();
  } catch {
    /* ignore */
  }
  let joinDiag = {};
  try {
    joinDiag = require('./joinDiagnostics').getJoinDiagnostics();
  } catch {
    /* ignore */
  }
  return {
    maxGroups: operationalLimits.getMaxGroups(),
    maxGroupsEffective: operationalLimits.getMaxGroups(),
    profile: cfg.OPERATION_PROFILE,
    autoProfile: auto.enabled,
    spamRiskScore: auto.riskScore,
    spamRiskReasons: auto.reasons,
    minMembers: cfg.MIN_MEMBERS_IN_GROUP ?? 0,
    autoJoinGroups: Boolean(cfg.AUTO_JOIN_GROUPS),
    autoPostOnJoin: Boolean(cfg.AUTO_POST_ON_JOIN),
    maxJoinPerHour: cfg.MAX_JOIN_PER_HOUR,
    postDelayMin: cfg.POST_DELAY_MIN,
    postDelayMax: cfg.POST_DELAY_MAX,
    joinDelayMin: cfg.JOIN_DELAY_MIN,
    joinDelayMax: cfg.JOIN_DELAY_MAX,
    joinQueue: joinQueuePending(),
    joinQueuePersist: joinDiag.joinQueuePersist ?? joinQueuePending(),
    pendingInvitesDisk: joinDiag.pendingInvitesDisk ?? 0,
    joinsThisHour: joinDiag.joinsThisHour ?? 0,
    postsPaused: runtimeControls.isPostsPaused(),
    promoQueue: (() => {
      try {
        return require('./promoQueue').pendingCount();
      } catch {
        return 0;
      }
    })(),
    hanorkCampaignEnabled: (() => {
      try {
        return require('./runtimeSettings').isHanorkCampaignEnabled();
      } catch {
        return true;
      }
    })(),
  };
};

const content = require('./contentManager');

exports.listCampaigns = () => content.listCampaigns();

exports.getCampaignTexts = (campaign) => content.getTexts(campaign);

exports.setCampaignTexts = (campaign, opts) => content.setTexts(campaign, opts);

exports.listCampaignMedia = (campaign) => content.listMedia(campaign);

exports.saveCampaignMedia = (opts) => content.saveMedia(opts);

exports.removeCampaignMedia = (opts) => content.removeMedia(opts);

exports.reloadContentConfig = () => content.reloadConfig();

exports.requestLogout = async () => {
  try {
    return await runtimeBridge.requestLogout();
  } catch (e) {
    return { ok: false, error: 'logout_failed', message: e?.message || String(e) };
  }
};

exports.startPairing = async (phone, opts = {}) => {
  try {
    const out = await runtimeBridge.requestPairing(phone, opts);
    if (!out.ok) return out;
    return {
      ok: true,
      waiting: Boolean(out.waiting),
      phone: out.phone,
      code: out.code || null,
      formatted: out.formatted || null,
    };
  } catch (e) {
    return { ok: false, error: 'pairing_failed', message: e?.message || String(e) };
  }
};
