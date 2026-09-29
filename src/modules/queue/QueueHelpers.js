'use strict';

const QueueService = require('./QueueService');
const SafeDeliveryService = require('../delivery/SafeDeliveryService');
const logger = require('../../config/logger');

const DELIVERY_QUEUE = 'delivery:products';

function isRealQueueEnabled() {
  try {
    require('bull');
  } catch {
    return false;
  }
  const url = process.env.REDIS_URL || '';
  return url && url !== 'memory://' && !url.startsWith('memory://');
}

function isDuplicateJobError(err) {
  const msg = String(err?.message || '').toLowerCase();
  return msg.includes('already exists') || msg.includes('jobid') || msg.includes('duplicate');
}

/**
 * Agenda entrega segura (fila Bull) ou executa síncrono se Redis/fila indisponível.
 */
async function scheduleDelivery(orderId, telegramId, items, userId) {
  const tid = telegramId != null ? String(telegramId) : null;
  if (!orderId || !tid || !items?.length) {
    throw new Error('scheduleDelivery: orderId, telegramId e items são obrigatórios');
  }

  const payload = { orderId, telegramId: tid, items, userId };
  const chatId = parseInt(tid, 10) || tid;
  const jobId = `delivery-${orderId}`;

  if (isRealQueueEnabled()) {
    try {
      const job = await QueueService.add(DELIVERY_QUEUE, payload, {
        jobId,
        removeOnComplete: 100,
        removeOnFail: 50,
      });
      logger.info(`[QUEUE] Entrega agendada job=${job?.id} order=${orderId}`);
      return { scheduled: true, via: 'queue', jobId: job?.id || jobId };
    } catch (e) {
      if (isDuplicateJobError(e)) {
        logger.info(`[QUEUE] Job já existe order=${orderId} — entrega já agendada`);
        return { scheduled: true, via: 'queue', jobId, duplicate: true };
      }
      logger.warn(`[QUEUE] Falha ao enfileirar ${orderId}: ${e.message}`);
    }

    const pending = await QueueService.hasPendingJob(DELIVERY_QUEUE, jobId);
    if (pending) {
      logger.info(`[QUEUE] Job ativo/aguardando order=${orderId} — skip entrega síncrona`);
      return { scheduled: true, via: 'queue', jobId, pending: true };
    }
  }

  const bot = global.botInstance;
  if (!bot?.telegram) {
    throw new Error('Bot não disponível para entrega síncrona');
  }

  const result = await SafeDeliveryService.deliverSafe(bot.telegram, chatId, items, orderId, userId);
  logger.info(`[QUEUE] Entrega síncrona order=${orderId} delivered=${result.delivered} reason=${result.reason || 'ok'}`);
  return { scheduled: true, via: 'sync', result };
}

const SMM_FULFILL_QUEUE = 'smm:fulfill';

async function scheduleSmmFulfill(orderId, telegramId, userId) {
  const tid = telegramId != null ? String(telegramId) : null;
  if (!orderId || !tid) {
    throw new Error('scheduleSmmFulfill: orderId e telegramId são obrigatórios');
  }

  const payload = { orderId, telegramId: tid, userId };
  const jobId = `smm-${orderId}`;

  if (isRealQueueEnabled()) {
    try {
      const job = await QueueService.add(SMM_FULFILL_QUEUE, payload, {
        jobId,
        removeOnComplete: 100,
        removeOnFail: 50,
      });
      logger.info(`[QUEUE] SMM fulfill agendado job=${job?.id} order=${orderId}`);
      return { scheduled: true, via: 'queue', jobId: job?.id || jobId };
    } catch (e) {
      if (isDuplicateJobError(e)) {
        return { scheduled: true, via: 'queue', jobId, duplicate: true };
      }
      logger.warn(`[QUEUE] SMM fulfill fila falhou ${orderId}: ${e.message}`);
    }
  }

  const SmmFulfillmentService = require('../smm/services/fulfillmentService');
  const bot = global.botInstance;
  const result = await SmmFulfillmentService.fulfillHanorkOrder(orderId, bot);
  return { scheduled: true, via: 'sync', result };
}

const VIRTUO_FULFILL_QUEUE = 'virtuo:fulfill';

function orderNeedsVirtuoFulfill(hanorkOrderId) {
  try {
    const VirtuoOrderRepository = require('../virtuo/repositories/virtuoOrderRepository');
    const order = VirtuoOrderRepository.findByHanorkOrderId(hanorkOrderId);
    if (!order) return false;
    if (order.phone && order.virtuo_order_id) return false;
    const retryable = new Set(['awaiting_payment', 'paid', 'failed']);
    return retryable.has(order.status);
  } catch {
    return true;
  }
}

async function scheduleVirtuoFulfill(orderId, telegramId, userId) {
  const tid = telegramId != null ? String(telegramId) : null;
  if (!orderId || !tid) {
    throw new Error('scheduleVirtuoFulfill: orderId e telegramId são obrigatórios');
  }

  const payload = { orderId, telegramId: tid, userId };
  const jobId = `virtuo-${orderId}`;

  if (isRealQueueEnabled()) {
    try {
      const job = await QueueService.add(VIRTUO_FULFILL_QUEUE, payload, {
        jobId,
        removeOnComplete: 100,
        removeOnFail: 50,
      });
      logger.info(`[QUEUE] Virtuo fulfill agendado job=${job?.id} order=${orderId}`);
      return { scheduled: true, via: 'queue', jobId: job?.id || jobId };
    } catch (e) {
      if (isDuplicateJobError(e)) {
        const pending = await QueueService.hasPendingJob(VIRTUO_FULFILL_QUEUE, jobId);
        if (pending) {
          logger.info(`[QUEUE] Virtuo fulfill já na fila order=${orderId}`);
          return { scheduled: true, via: 'queue', jobId, duplicate: true, pending: true };
        }
        if (!orderNeedsVirtuoFulfill(orderId)) {
          return { scheduled: true, via: 'queue', jobId, duplicate: true, alreadyFulfilled: true };
        }
        logger.warn(`[QUEUE] Virtuo fulfill job duplicado — reprocessando sync order=${orderId}`);
      } else {
        logger.warn(`[QUEUE] Virtuo fulfill fila falhou ${orderId}: ${e.message}`);
        const pending = await QueueService.hasPendingJob(VIRTUO_FULFILL_QUEUE, jobId);
        if (pending) {
          return { scheduled: true, via: 'queue', jobId, pending: true };
        }
      }
    }
  }

  const VirtuoFulfillmentService = require('../virtuo/services/fulfillmentService');
  const bot = global.botInstance;
  const needsRetry = orderNeedsVirtuoFulfill(orderId);
  const result = await VirtuoFulfillmentService.fulfillHanorkOrder(orderId, bot, {
    forceRetry: needsRetry,
  });
  logger.info(`[QUEUE] Virtuo fulfill sync order=${orderId}`, {
    ok: result.ok,
    reason: result.reason,
  });
  return { scheduled: true, via: 'sync', result };
}

const WA_DIV_CAMPAIGN_QUEUE = 'wadv:campaign';

async function scheduleWaDivCampaign(telegramId, payload, delayMs = 0) {
  const tid = telegramId != null ? String(telegramId) : null;
  if (!tid || !payload?.groupIds?.length) {
    throw new Error('scheduleWaDivCampaign: telegramId e groupIds são obrigatórios');
  }

  const jobId = payload.jobId || `wadv-sched-${tid}-${Date.now()}`;
  const data = { ...payload, telegramId: tid, jobId };
  const opts = {
    jobId,
    removeOnComplete: 100,
    removeOnFail: 50,
  };
  if (delayMs > 0) opts.delay = delayMs;

  if (isRealQueueEnabled()) {
    try {
      const job = await QueueService.add(WA_DIV_CAMPAIGN_QUEUE, data, opts);
      logger.info(`[QUEUE] Hanork Div campanha agendada job=${job?.id} tg=${tid} delay=${delayMs}ms`);
      try {
        const { logWadvQueueEvent } = require('../wa-divulgacao/waDivulgacaoQueueMetrics');
        logWadvQueueEvent('enqueue', {
          queue: WA_DIV_CAMPAIGN_QUEUE,
          correlationId: job?.id || jobId,
          jobId: job?.id || jobId,
          telegramId: tid,
          delayMs,
          groups: data.groupIds?.length,
          mode: data.mode,
        });
      } catch {
        /* ignore */
      }
      return { scheduled: true, via: 'queue', jobId: job?.id || jobId, runAt: delayMs > 0 ? Date.now() + delayMs : Date.now() };
    } catch (e) {
      if (isDuplicateJobError(e)) {
        return { scheduled: true, via: 'queue', jobId, duplicate: true };
      }
      logger.warn(`[QUEUE] Hanork Div campanha fila falhou tg=${tid}: ${e.message}`);
    }
  }

  if (delayMs > 0) {
    return { scheduled: false, via: 'none', message: 'Agendamento requer Redis/Bull ativo.' };
  }

  const { processWaDivCampaign } = require('../wa-divulgacao/queue/waDivulgacaoCampaignJob');
  await processWaDivCampaign({ id: jobId, data });
  return { scheduled: true, via: 'sync', jobId };
}

module.exports = {
  scheduleDelivery,
  scheduleSmmFulfill,
  scheduleVirtuoFulfill,
  scheduleWaDivCampaign,
  isRealQueueEnabled,
  SMM_FULFILL_QUEUE,
  VIRTUO_FULFILL_QUEUE,
  WA_DIV_CAMPAIGN_QUEUE,
};
