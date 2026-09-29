'use strict';

const logger = require('../../../config/logger');
const { jobLogFields } = require('../jobLogContext');
const { correlationContext } = require('../../../infrastructure');
const {
  orchestrateCatalogAiSync,
  processCatalogProductAi,
  deferCatalogJob,
} = require('../../../plugins/zero-divu/catalogAiSync');
const { getCatalogDeps } = require('../../../plugins/zero-divu/catalogDeps');

async function processCatalogAi(job) {
  const meta = jobLogFields(job, { queueName: 'ai:catalog' });
  const start = Date.now();
  const { mode, productId, source } = job.data || {};
  const GptQueue = require('../../../services/GptRequestQueue');

  return correlationContext.runWithId(async () => {
    if (mode === 'full' && GptQueue.isBootGuardActive?.()) {
      return deferCatalogJob(job, meta, 'boot_guard');
    }
    if (mode === 'product' && GptQueue.isBootGuardActive?.()) {
      return deferCatalogJob(job, meta, 'boot_guard');
    }

    logger.info('[CATALOG_AI:JOB] start', { ...meta, mode, productId, source });

    try {
      if (mode === 'full') {
        const r = await orchestrateCatalogAiSync(getCatalogDeps(), { source });
        logger.info('[CATALOG_AI:JOB] full done', {
          ...meta,
          durationMs: Date.now() - start,
          enqueued: r.enqueued,
          count: r.count,
        });
        return r;
      }

      if (mode === 'product') {
        const r = await processCatalogProductAi(productId, getCatalogDeps());
        logger.info('[CATALOG_AI:JOB] product done', {
          ...meta,
          durationMs: Date.now() - start,
          productId,
          ok: r.ok,
          template: r.template || false,
        });
        return r;
      }

      return { ok: false, error: 'unknown_mode', mode };
    } catch (err) {
      if (err.code === 'AI_COOLDOWN') {
        return deferCatalogJob(job, meta, 'boot_guard');
      }
      logger.warn('[CATALOG_AI:JOB] failed', {
        ...meta,
        durationMs: Date.now() - start,
        err: err.message,
        code: err.code,
      });
      throw err;
    }
  });
}

module.exports = { processCatalogAi };
