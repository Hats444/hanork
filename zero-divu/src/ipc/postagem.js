'use strict';

const cfg = require('../config/divulgacao');
const rotacao = require('./rotacao');
const groupValidator = require('./groupValidator');
const statusMessage = require('./statusMessage');
const postGuard = require('./postGuard');
const mediaFinder = require('../utils/mediaFinder');
const operationContext = require('../utils/operationContext');
const { QueueWorker } = require('./queueWorker');
const persistentQueue = require('./persistentQueue');
const persistentLocks = require('./persistentLocks');
const antiBan = require('./antiBan');
const logThrottle = require('../utils/logThrottle');
const { errorLog, infoLog, warningLog, opLog } = require('../utils/logger');
const bootQuiet = require('../utils/bootQuiet');

const deliveryWorker = new QueueWorker('delivery', {
  concurrency: 1,
  payloadKey: 'cycleKey',
  intervalMs: 2000,
});
let deliveryStarted = false;
let sockRef = null;

function isOnline() {
  try {
    if (require('./gracefulShutdownManager').isShuttingDown()) return false;
    const registry = require('./socketRegistry');
    const sock = registry.get();
    return registry.isOnline(sock || sockRef);
  } catch {
    return false;
  }
}

function maxGroupsAllowed(opts = {}) {
  if (opts.source === 'event') return 1;
  try {
    if (require('./groupEventScheduler').isEnabled()) {
      return require('./distributedScheduler').maxGroupsPerWake() || 1;
    }
  } catch {
    /* ignore */
  }
  return cfg.MAX_GROUPS_PER_CYCLE || 15;
}

function normalizeGroupIds(groupIds, opts = {}) {
  const max = maxGroupsAllowed(opts);
  if (!groupIds?.length) return [];
  if (groupIds.length <= max) return groupIds;
  warningLog(`Entrega limitada a ${max} GP (recebido ${groupIds.length})`);
  return groupIds.slice(0, max);
}

function getCaption(item) {
  return item.caption || item.text || rotacao.nextText();
}

async function publishStatus(sock, groupIds, item, opts = {}) {
  if (!isOnline()) {
    warningLog('Publicação cancelada — conexão indisponível');
    return 0;
  }

  const caption = getCaption(item);
  const mediaKey =
    item.mediaLabel || item.file || (item.type !== 'text' ? item.type : 'text');
  let payload = null;

  if (item.type !== 'text') {
    payload = await statusMessage.buildFromLocal({ ...item, caption: '' });
  }

  if (!payload && item.productId != null) {
    const hanorkOverlay = require('./hanorkAutoOverlay');
    const productFile = hanorkOverlay.productImagePath(`auto-prod-${item.productId}.jpg`);
    if (productFile) {
      payload = await statusMessage.buildFromLocal({
        type: 'image',
        file: productFile,
        caption: '',
      });
    }
  }

  if (!payload && item.productId != null) {
    const menuPath = require('./menuPhotoFallback').nextMenuPhotoPath();
    if (menuPath) {
      payload = await statusMessage.buildFromLocal({
        type: 'image',
        file: menuPath,
        caption: '',
      });
    }
  }

  if (!payload && !item.file && !item.productId) {
    const menuPath = require('./menuPhotoFallback').nextMenuPhotoPath();
    if (menuPath) {
      payload = await statusMessage.buildFromLocal({
        type: 'image',
        file: menuPath,
        caption: '',
      });
    }
  }

  if (!payload && (item.file || item.productId)) {
    warningLog(
      `Mídia do produto indisponível${item.productId ? ` (id ${item.productId})` : ''} — legenda só texto`
    );
  }

  if (!payload) {
    payload = statusMessage.buildTextStatus(caption);
  }

  if (!payload) {
    warningLog('Post vazio — sem texto nem mídia');
    return 0;
  }

  const stats = await statusMessage.broadcastToGroups(
    sock,
    payload,
    groupIds,
    (gid, ok) => {
      groupValidator.recordPostResult(gid, ok, {
        mediaKey: ok ? mediaKey : undefined,
        campaignId: ok ? item.campanha || item._campaignId : undefined,
      });
      if (ok && (item.campanha || item._campaignId)) {
        try {
          const monitor = require('./monitor');
          const cid = item.campanha || item._campaignId;
          if (cid === 'hanork') monitor.inc('postsHanork');
          else if (cid === 'zero') monitor.inc('postsZero');
        } catch {
          /* ignore */
        }
      }
    },
    caption,
    {
      ...opts,
      productId: item.productId ?? opts.productId ?? null,
      productName: item.productName ?? opts.productName ?? null,
      imagePath: item.file && require('path').isAbsolute(String(item.file)) ? item.file : opts.imagePath,
      campaign: item.campanha || item._campaignId || opts.campaign,
      source: opts.source || 'rotation',
      chatText: item.chatCaption || opts.chatText || null,
    }
  );

  return stats.sent || 0;
}

function eventSchedulerOn() {
  try {
    return require('./groupEventScheduler').isEnabled();
  } catch {
    return false;
  }
}

async function executePostCycle(sock, groupIds, opts = {}) {
  groupIds = normalizeGroupIds(groupIds, opts);
  if (!groupIds.length) return 0;
  if (!isOnline()) return 0;

  const cycleLock = require('../utils/cycleLock');
  const out = await cycleLock.runExclusive('post', async () => {
    if (!isOnline()) return 0;

    if (cfg.USE_GROUP_STATUS === false) {
      errorLog('USE_GROUP_STATUS desativado — ative para divulgar');
      return 0;
    }

    if (!opts.bypassRiskPause && !antiBan.canPostNow(opts)) {
      const waitInfo = require('../utils/antiBanWaitLabel').getAntiBanWaitInfo();
      if (logThrottle.shouldLog('post-cycle-antiban', 5 * 60 * 1000)) {
        infoLog(`Ciclo adiado — anti-ban ~${waitInfo.label}`);
      }
      return 0;
    }

    const rotOpts =
      groupIds.length === 1 ? { groupId: groupIds[0] } : {};
    const item = opts.campaign
      ? require('./rotacao').nextStatusPostForCampaign(opts.campaign) ||
        rotacao.nextStatusPost(rotOpts)
      : rotacao.nextStatusPost(rotOpts);

    if (item?.skip) {
      infoLog(`Status ignorado — ${item.reason || 'sem catálogo Hanork sincronizado'}`);
      return 0;
    }
    if (!item?.caption && item?.type === 'text' && !item?.file) {
      warningLog('Post vazio — aguardando sync de produtos Hanork');
      return 0;
    }
    const mediaPath =
      item.file || (item.type !== 'text' ? mediaFinder.findMedia(item.type) : null);
    const midia =
      item.mediaLabel && item.type !== 'text'
        ? item.mediaLabel
        : item.type === 'text'
          ? 'só texto'
          : item.type;

    infoLog(
      `Campanha: ${item.campanha || '—'} · ${item.tipo || 'status'} · ${midia}${mediaPath ? ` · ${mediaFinder.describeMedia(mediaPath)}` : ''}`
    );

    try {
      return await publishStatus(sock, groupIds, item, opts);
    } catch (e) {
      errorLog(`Publicação: ${e.message}`);
      return 0;
    }
  });

  if (out?.skipped) return 0;
  return out?.result ?? 0;
}

function ensureDeliveryWorker(sock) {
  if (deliveryStarted) return;
  sockRef = sock;
  deliveryWorker.setProcessor(async (payload, job) => {
    if (!sockRef || !isOnline()) throw new Error('socket indisponível');
    const ids = normalizeGroupIds(payload.groupIds || [], payload.opts || {});
    if (!ids.length) {
      persistentQueue.complete('delivery', job.id);
      return 0;
    }
    return executePostCycle(sockRef, ids, { ...(payload.opts || {}), fromQueue: true });
  });
  deliveryWorker.start();
  deliveryStarted = true;
}

exports.startWorkers = (sock) => {
  if (cfg.PERSISTENT_QUEUES_ENABLED === false) return;

  if (eventSchedulerOn()) {
    const fixed = persistentQueue.sanitizeDeliveryJobs(1);
    const cleared = persistentQueue.clearAllDelivery();
    if (fixed) bootQuiet.bootInfo(infoLog, `Fila delivery: ${fixed} job(s) antigo(s) dividido(s) em 1 GP`);
    if (cleared) {
      bootQuiet.bootInfo(
        infoLog,
        `Fila delivery: ${cleared} job(s) removido(s) — scheduler event-driven`
      );
    } else {
      bootQuiet.bootInfo(infoLog, 'Fila delivery: desativada (scheduler event-driven · 1 GP/vez)');
    }
    require('./joinManager').startWorkers(sock);
    return;
  }

  const fixed = persistentQueue.sanitizeDeliveryJobs(1);
  const deduped = persistentQueue.dedupeDeliveryJobs();
  const purged = persistentQueue.purgeStale('delivery');
  if (fixed) bootQuiet.bootInfo(infoLog, `Fila delivery: ${fixed} job(s) antigo(s) dividido(s) em 1 GP`);
  if (deduped) bootQuiet.bootInfo(infoLog, `Fila delivery: ${deduped} duplicado(s) removido(s)`);
  if (purged) bootQuiet.bootInfo(infoLog, `Fila delivery: ${purged} obsoleto(s) removido(s)`);
  ensureDeliveryWorker(sock);
  require('./joinManager').startWorkers(sock);
};

exports.stopWorkers = () => {
  deliveryWorker.stop();
  deliveryStarted = false;
  sockRef = null;
  try {
    persistentQueue.reclaimProcessing('delivery', 0);
  } catch {
    /* ignore */
  }
  require('./joinManager').stopWorkers();
};

async function runPostCycle(sock, groupIds, opts = {}) {
  groupIds = normalizeGroupIds(groupIds, opts);
  if (!groupIds.length) return 0;
  if (!isOnline()) return 0;

  try {
    if (!opts.forceAdmin && require('../ipc/runtimeControls').isPostsPaused()) {
      warningLog('Postagem bloqueada — pausado pelo admin (Telegram)');
      return 0;
    }
  } catch {
    /* IPC opcional */
  }

  const cycleKey = `cycle-${groupIds[0]?.slice(0, 12) || 'x'}`;
  if (persistentLocks.hasActive('cycle', cycleKey)) {
    warningLog('Ciclo de entrega já em andamento — ignorando duplicata');
    return 0;
  }

  const cycleLock = persistentLocks.acquire('cycle', { key: cycleKey, groups: groupIds.length }, 20 * 60 * 1000);
  const skipQueue =
    opts.source === 'event' || opts.skipQueue === true || eventSchedulerOn();

  return operationContext.withOp(
    'delivery',
    { queue: 'delivery', groups: groupIds.length, source: opts.source || 'cycle' },
    async (opId) => {
      let job = null;
      try {
        if (cfg.PERSISTENT_QUEUES_ENABLED !== false && !skipQueue) {
          ensureDeliveryWorker(sock);
          const jobKey = `${cycleKey}-${Date.now().toString(36)}`;
          job = deliveryWorker.enqueue(
            { groupIds, opts: { ...opts, direct: true }, cycleKey: jobKey },
            'delivery',
            { schedule: false }
          );
          if (job) {
            persistentQueue.claimById('delivery', job.id);
            opLog('INFO', `Entrega [${job.id.slice(0, 6)}] · ${groupIds.length} GP`, {
              opId,
              queue: 'delivery',
            });
          }
        }

        const started = Date.now();
        require('./checkpoints').record('before_delivery', {
          groups: groupIds.length,
          opId,
        });
        const sent = await executePostCycle(sock, groupIds, { ...opts, direct: true });
        if (job) persistentQueue.complete('delivery', job.id);
        require('./checkpoints').record('after_delivery', {
          sent,
          total: groupIds.length,
          ms: Date.now() - started,
        });
        opLog('OK', `Entrega concluída: ${sent}/${groupIds.length}`, {
          opId,
          queue: 'delivery',
          ms: Date.now() - started,
        });
        return sent;
      } catch (e) {
        if (job) persistentQueue.fail('delivery', job.id, e.message);
        throw e;
      } finally {
        persistentLocks.release(cycleLock.lockId);
      }
    }
  );
}

async function postOnJoin(sock, groupId) {
  if (cfg.USE_GROUP_STATUS === false) return false;

  const respectLimits = cfg.JOIN_WELCOME_RESPECT_LIMITS !== false;
  const check = postGuard.canPostToGroup(groupId, {
    allowGraceBypass: !respectLimits,
  });
  if (!check.ok) return false;

  const item = rotacao.nextStatusPost({ groupId });
  const caption = getCaption(item);
  let payload = null;

  if (item.type !== 'text') {
    payload = await statusMessage.buildFromLocal(item);
    if (!payload) return false;
  } else {
    payload = statusMessage.buildTextStatus(caption);
  }

  const result = await statusMessage.postToGroup(sock, groupId, payload, caption, {
    skipGuard: true,
    chatText: item.chatCaption || null,
    productId: item.productId ?? null,
    productName: item.productName ?? null,
  });
  if (result.ok) {
    groupValidator.recordPostResult(groupId, true, {
      campaignId: item.campanha || item._campaignId,
    });
  } else if (result.reason) {
    const labels = require('../utils/groupLabels');
    infoLog(`Status de entrada não enviado (${labels.shortId(groupId)}): ${result.reason}`);
  }
  return result.ok;
}

async function postVisitOnce(sock, groupId) {
  if (cfg.USE_GROUP_STATUS === false) return;

  const item = rotacao.nextStatusPost();
  const caption = getCaption(item);
  let payload = null;

  if (item.type !== 'text') {
    payload = await statusMessage.buildFromLocal(item);
    if (!payload) return;
  } else {
    payload = statusMessage.buildTextStatus(caption);
  }

  const result = await statusMessage.postToGroup(sock, groupId, payload, caption, {
    skipGuard: true,
    chatText: item.chatCaption || null,
    productId: item.productId ?? null,
    productName: item.productName ?? null,
  });
  groupValidator.recordPostResult(groupId, result.ok);
  groupValidator.registerGroup(groupId, { visitPostDone: true });
}

module.exports = {
  runPostCycle,
  postOnJoin,
  postVisitOnce,
  startWorkers: exports.startWorkers,
  stopWorkers: exports.stopWorkers,
  buildGroupStatusPayload: statusMessage.buildFromLocal,
  sendStatusToGroup: statusMessage.postToGroup,
  broadcastStatus: (sock, payload, ids, textFallback) =>
    statusMessage.broadcastToGroups(sock, payload, ids, (gid, ok) =>
      groupValidator.recordPostResult(gid, ok), textFallback),
};
