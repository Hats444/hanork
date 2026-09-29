/**
 * Job: Delivery
 * Entrega assíncrona com proteção contra duplicação
 */
const logger = require('../../../config/logger');
const SafeDeliveryService = require('../../delivery/SafeDeliveryService');
const { jobLogFields } = require('../jobLogContext');
const { correlationContext } = require('../../../infrastructure');

async function processDelivery(job) {
  const meta = jobLogFields(job, { queueName: 'delivery:products' });
  const start = Date.now();

  return correlationContext.runWithId(async () => {
    logger.info('[DELIVERY:JOB] Starting', meta);

    const bot = global.botInstance;
    if (!bot) {
      throw new Error('Bot instance not available');
    }

    const { orderId, telegramId, items, userId } = job.data;

    try {
      const result = await SafeDeliveryService.deliverSafe(
        bot.telegram,
        telegramId,
        items,
        orderId,
        userId
      );

      const durationMs = Date.now() - start;
      if (result.delivered) {
        logger.info('[DELIVERY:JOB] Delivered', { ...meta, txId: result.txId, durationMs });
      } else {
        logger.warn('[DELIVERY:JOB] Skipped', { ...meta, reason: result.reason, durationMs });
      }

      return result;
    } catch (err) {
      logger.error('[DELIVERY:JOB] Failed', { ...meta, err: err.message, durationMs: Date.now() - start });
      throw err;
    }
  }, meta.orderId ? `delivery:${meta.orderId}` : undefined);
}

async function processResend(job) {
  const meta = jobLogFields(job, { queueName: 'delivery:resend' });
  const start = Date.now();

  return correlationContext.runWithId(async () => {
    const bot = global.botInstance;
    if (!bot) {
      throw new Error('Bot instance not available');
    }

    const { orderId, productId, telegramId } = job.data;
    const result = await SafeDeliveryService.resendSafe(bot.telegram, telegramId, orderId, productId);
    logger.info('[DELIVERY:JOB] Resend done', {
      ...meta,
      success: !!(result?.delivered || result),
      durationMs: Date.now() - start,
    });
    return { success: result?.delivered || result, orderId, productId };
  }, meta.orderId ? `resend:${meta.orderId}` : undefined);
}

module.exports = {
  processDelivery,
  processResend
};
