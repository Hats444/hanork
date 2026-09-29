'use strict';

const fs = require('fs-extra');
const path = require('path');
const QueueService = require('../../modules/queue/QueueService');
const logger = require('../../config/logger');
const { getZeroDivuClient } = require('./ZeroDivuClient');
const { getCatalogDeps } = require('./catalogDeps');
const { CATALOG_FILE, buildPlainProductText } = require('./hanorkAutoSync');

const QUEUE_NAME = 'ai:catalog';
const FULL_JOB_ID = 'catalog-ai-full';

function catalogUsesAsyncAi() {
  const v = String(process.env.HANORK_WA_CATALOG_USE_AI || '').toLowerCase();
  const aiOn = v === '1' || v === 'true' || v === 'yes';
  if (!aiOn) return false;
  const asyncV = String(process.env.HANORK_WA_CATALOG_ASYNC_AI ?? '1').toLowerCase();
  return asyncV !== '0' && asyncV !== 'false' && asyncV !== 'no';
}

function productDelayMs() {
  return Math.max(5000, Number(process.env.HANORK_WA_CATALOG_AI_PRODUCT_DELAY_MS) || 30000);
}

function catalogAiDeferMs() {
  const GptQueue = require('../../services/GptRequestQueue');
  const step = productDelayMs();
  if (GptQueue.isBootGuardActive?.()) {
    return Math.max(step, GptQueue.bootGuardRemainingMs?.() || step);
  }
  if (GptQueue.isRateLimited?.()) {
    const until = GptQueue.getRateLimitedUntil?.() || 0;
    return Math.max(step, until - Date.now());
  }
  return step;
}

async function deferCatalogJob(job, meta, reason) {
  const delayMs = Math.max(5000, catalogAiDeferMs());
  if (typeof job?.moveToDelayed === 'function') {
    await job.moveToDelayed(Date.now() + delayMs);
  }
  logger.debug('[CATALOG_AI:JOB] deferred', {
    ...meta,
    reason,
    delayMs,
  });
  return { ok: false, deferred: true, reason, delayMs };
}

function catalogFilePath() {
  return path.join(getZeroDivuClient().ipcDir, CATALOG_FILE);
}

async function readCatalogPayload() {
  const p = catalogFilePath();
  if (!(await fs.pathExists(p))) return null;
  try {
    return await fs.readJson(p);
  } catch {
    return null;
  }
}

async function writeCatalogPayload(payload) {
  const client = getZeroDivuClient();
  client.ensureDir();
  const outPath = catalogFilePath();
  await fs.writeJson(outPath, payload, { spaces: 2 });
  return outPath;
}

async function updateCatalogProductText(productId, texto, textoChat = null) {
  const payload = (await readCatalogPayload()) || {
    updatedAt: new Date().toISOString(),
    source: 'hanork_auto_broadcast',
    productCount: 0,
    variacoes: [],
  };
  const pid = Number(productId);
  const idx = (payload.variacoes || []).findIndex((v) => Number(v.productId) === pid);
  if (idx < 0) return { ok: false, reason: 'product_not_in_catalog' };

  payload.variacoes[idx].texto = texto;
  if (textoChat) payload.variacoes[idx].textoChat = textoChat;
  payload.variacoes[idx].aiUpdatedAt = new Date().toISOString();
  payload.updatedAt = new Date().toISOString();
  payload.productCount = payload.variacoes.length;
  payload.aiAsync = true;

  await writeCatalogPayload(payload);
  return { ok: true, productId: pid };
}

async function resolveUsername(deps) {
  let username = '';
  if (typeof deps?.getBotUsername === 'function') {
    username = (await deps.getBotUsername()) || '';
  }
  if (!username) username = process.env.BOT_USERNAME || '';
  return username;
}

/**
 * Gera texto IA para um produto e atualiza hanork_auto_catalog.json incrementalmente.
 */
async function processCatalogProductAi(productId, depsIn = null) {
  const deps = depsIn || getCatalogDeps();
  if (!deps?.loadProducts) {
    return { ok: false, error: 'missing_deps' };
  }

  const products = await deps.loadProducts();
  const p = (products || []).find((x) => Number(x.id) === Number(productId));
  if (!p) return { ok: false, error: 'product_not_found' };

  const username = await resolveUsername(deps);
  const { prepareWaPromoPlain, prepareWaChatPlain } = require('../../utils/waCaptionPrepare');
  const { buildWaPlainPromo, buildWaChatPromo } = require('../../utils/persuasiveProductCopy');
  const { getFlashSale } = require('./hanorkAutoSync');
  const { shouldDeferAiForChannel } = require('../../utils/broadcastAiCopy');
  const GptProviderPool = require('../../services/GptProviderPool');

  const sale = getFlashSale(deps.prisma, p.id);
  const skipAi =
    shouldDeferAiForChannel('wa') ||
    (typeof GptProviderPool.hasAvailableProvider === 'function' &&
      !GptProviderPool.hasAvailableProvider());

  let texto;
  let usedTemplate = false;

  if (skipAi) {
    texto = buildWaPlainPromo(p, { sale, username });
    usedTemplate = true;
    logger.debug('[CATALOG_AI] template (IA indisponível)', {
      category: 'HANORK',
      module: 'WA',
      productId: p.id,
    });
  } else {
    try {
      texto = await buildPlainProductText(p, {
        prisma: deps.prisma,
        username,
        dbRaw: deps.dbRaw || null,
        useAi: true,
      });
    } catch (e) {
      logger.warn(`[CATALOG_AI] IA falhou produto ${productId} — template`, {
        category: 'HANORK',
        module: 'WA',
        productId,
        err: e.message,
      });
      texto = buildWaPlainPromo(p, { sale, username });
      usedTemplate = true;
    }
  }

  texto = prepareWaPromoPlain(texto, {
    productName: p.name,
    productId: p.id,
    username,
  });

  const textoChat = prepareWaChatPlain(buildWaChatPromo(p, { sale, username }), {
    productName: p.name,
    productId: p.id,
    username,
  });

  const upd = await updateCatalogProductText(p.id, texto, textoChat);
  if (!upd.ok) return upd;

  logger.info(`[CATALOG_AI] Produto ${p.id} atualizado (${p.name})`, {
    category: 'HANORK',
    module: 'WA',
    productId: p.id,
    template: usedTemplate,
  });
  return { ok: true, productId: p.id, productName: p.name, template: usedTemplate };
}

/**
 * Orquestra: template sync + jobs por produto (1/30s).
 */
async function orchestrateCatalogAiSync(depsIn = null, options = {}) {
  const deps = depsIn || getCatalogDeps();
  if (!deps) return { ok: false, error: 'missing_deps' };

  const { syncHanorkCatalogToZero } = require('./hanorkAutoSync');
  const templateResult = await syncHanorkCatalogToZero(deps, {
    useAi: false,
    skipAsyncEnqueue: true,
    source: options.source || 'ai:catalog',
  });
  if (!templateResult.ok) return templateResult;

  const payload = await readCatalogPayload();
  const productIds = (payload?.variacoes || [])
    .map((v) => Number(v.productId))
    .filter((id) => Number.isFinite(id) && id > 0);

  const step = productDelayMs();
  const GptQueue = require('../../services/GptRequestQueue');
  const bootOffset =
    options.source === 'boot' && GptQueue.isBootGuardActive?.()
      ? GptQueue.bootGuardRemainingMs?.() || 0
      : 0;
  let enqueued = 0;

  for (let i = 0; i < productIds.length; i++) {
    const pid = productIds[i];
    const jobId = `catalog-ai-prod-${pid}`;
    const existing = await QueueService.getJob(QUEUE_NAME, jobId);
    if (existing) {
      try {
        await existing.remove();
      } catch {
        /* ignore */
      }
    }
    await QueueService.add(
      QUEUE_NAME,
      { mode: 'product', productId: pid, source: options.source || 'ai:catalog' },
      {
        delay: bootOffset + i * step,
        jobId,
        removeOnComplete: true,
        attempts: 4,
        backoff: { type: 'exponential', delay: 60000 },
      }
    );
    enqueued++;
  }

  logger.info(`[CATALOG_AI] ${enqueued} job(s) de produto enfileirado(s)`, {
    category: 'HANORK',
    module: 'WA',
    source: options.source,
    stepMs: step,
    bootOffsetMs: bootOffset,
  });

  return { ok: true, count: templateResult.count, enqueued, asyncAi: true };
}

async function enqueueCatalogAiSync(deps, options = {}) {
  if (!catalogUsesAsyncAi()) {
    return { ok: false, skipped: true, reason: 'async_ai_disabled' };
  }

  const delayMs = Math.max(0, Number(options.delayMs) || 0);
  if (!options.force) {
    const pending = await QueueService.hasPendingJob(QUEUE_NAME, FULL_JOB_ID);
    if (pending) {
      return { ok: true, skipped: true, reason: 'already_pending' };
    }
  }

  const job = await QueueService.add(
    QUEUE_NAME,
    { mode: 'full', source: options.source || 'boot' },
    {
      delay: delayMs,
      jobId: FULL_JOB_ID,
      removeOnComplete: true,
      attempts: 3,
      backoff: { type: 'exponential', delay: 120000 },
    }
  );

  logger.info('[CATALOG_AI] Job full sync enfileirado', {
    category: 'HANORK',
    module: 'WA',
    jobId: job?.id,
    delayMs,
    source: options.source,
  });

  return { ok: true, jobId: job?.id, queued: 'full' };
}

/**
 * Limpa jobs stale do Redis no boot (evita catalog-ai-full duplicado de sessão anterior).
 */
async function resetCatalogAiQueueOnBoot() {
  if (String(process.env.HANORK_WA_CATALOG_KEEP_QUEUE_ON_BOOT || '') === '1') {
    return { skipped: true };
  }
  try {
    const queue = QueueService.initQueue(QUEUE_NAME);
    let removed = 0;
    for (const state of ['waiting', 'delayed', 'paused']) {
      const jobs = await queue.getJobs([state], 0, 500);
      for (const job of jobs) {
        try {
          await job.remove();
          removed++;
        } catch {
          /* ignore */
        }
      }
    }
    if (removed > 0) {
      logger.info('[CATALOG_AI] Fila limpa no boot', {
        category: 'HANORK',
        module: 'WA',
        removed,
      });
    }
    return { ok: true, removed };
  } catch (e) {
    logger.warn('[CATALOG_AI] reset queue on boot:', e.message);
    return { ok: false, error: e.message };
  }
}

module.exports = {
  QUEUE_NAME,
  catalogUsesAsyncAi,
  enqueueCatalogAiSync,
  orchestrateCatalogAiSync,
  processCatalogProductAi,
  readCatalogPayload,
  updateCatalogProductText,
  productDelayMs,
  catalogAiDeferMs,
  deferCatalogJob,
  resetCatalogAiQueueOnBoot,
};
