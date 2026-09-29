/**
 * Job: Broadcast
 * Envio de mensagens em massa para usuários
 */
const logger = require('../../../config/logger');
const { jobLogFields } = require('../jobLogContext');
const { correlationContext } = require('../../../infrastructure');
const MsgService = require('../../../telegram/MsgService');
const broadcastRateLimit = require('../../../services/broadcastRateLimit');
const BroadcastAdaptiveThrottle = require('../../../services/BroadcastAdaptiveThrottle');
const { resolvePvMinGapMs } = require('../../../config/broadcastConfig');
const { isStalePvBroadcastJob } = require('../../../services/broadcastPvQueue');
const { pickTelegramOpts, unwrapReplyMarkup, isBlockedError, isNetworkError } = require('../../../telegram/messageDelivery');
const dbConnect = require('../../../config/database-sqlite').connect;

function buildJobTelegramOpts(parseMode, replyMarkup) {
  const rm = replyMarkup || null;
  return pickTelegramOpts({
    parse_mode: parseMode || 'HTML',
    ...(rm ? { reply_markup: rm } : {}),
  });
}

async function processPvPromoDelivery(job) {
  const meta = jobLogFields(job, { queueName: 'broadcast:pv' });
  const start = Date.now();

  return correlationContext.runWithId(async () => {
    const {
      chatId,
      text,
      parseMode = 'HTML',
      replyMarkup = null,
      photo = null,
      requirePhoto = false,
      forcePhoto = false,
      editOnly = false,
      enforceAutoRateLimit = false,
      campaignType = null,
      campaignSlotKey = null,
    } = job.data || {};

    if (!chatId || !text) {
      throw new Error('broadcast:pv — chatId e text obrigatórios');
    }

    if (isStalePvBroadcastJob(job)) {
      logger.info('[BROADCAST:PV] job órfão ignorado', {
        ...meta,
        chatId,
        enqueuedAt: job.data?.enqueuedAt,
      });
      return { action: 'skipped', chatId, reason: 'stale_job' };
    }

    const dbRaw = () => dbConnect();
    let rateLimitedEditOnly = !!editOnly;

    if (enforceAutoRateLimit) {
      const gate = broadcastRateLimit.canSendPromo(dbRaw, chatId, {
        channel: 'user',
        enforceWindow: true,
      });
      if (!gate.ok) {
        if (gate.allowEditOnly) rateLimitedEditOnly = true;
        else return { action: 'rate_limited', chatId };
      }
    }

    try {
      const msgSvc = MsgService.get();
      const opts = buildJobTelegramOpts(parseMode, replyMarkup);
      const r = await msgSvc.sendToChat(chatId, text, {
        ...opts,
        photo: photo || undefined,
        promoMode: true,
        pvPromo: true,
        forceNew: false,
        editOnly: rateLimitedEditOnly,
        requirePhoto: !!requirePhoto,
        forcePhoto: !!forcePhoto,
        menuType: 'user_promo',
      });

      let action = 'skipped';
      if (r.action === 'blocked') action = 'blocked';
      else if (r.action === 'sent') {
        action = 'sent';
        if (enforceAutoRateLimit) {
          broadcastRateLimit.recordAutoSend(dbRaw, chatId, { channel: 'user' });
        }
      } else if (r.action === 'edited' || r.action === 'unchanged') action = 'edited';
      else if (r.action === 'failed' && r.error && isNetworkError({ message: r.error })) {
        action = 'network_failed';
      }

      if (rateLimitedEditOnly && action !== 'edited' && action !== 'unchanged') {
        BroadcastAdaptiveThrottle.recordSignal('tg_flood', { severity: 12 });
        return { action: 'rate_limited', chatId, durationMs: Date.now() - start };
      }

      if (campaignType && (action === 'sent' || action === 'edited')) {
        try {
          const { getCampaignStore } = require('../../../services/campaign/CampaignStore');
          getCampaignStore(dbRaw).recordUserDelivery(chatId, {
            campaignType,
            channel: 'telegram_pv',
            status: action,
            slotKey: campaignSlotKey,
          });
        } catch (e) {
          logger.warn('[BROADCAST:PV] campaign record:', e.message);
        }
      }

      logger.debug('[BROADCAST:PV] done', { ...meta, chatId, action });
      const minGap = resolvePvMinGapMs();
      if (minGap > 0) {
        await new Promise((r) => setTimeout(r, minGap));
      }
      return { action, chatId, durationMs: Date.now() - start };
    } catch (err) {
      if (isBlockedError(err)) return { action: 'blocked', chatId };
      if (isNetworkError(err)) return { action: 'network_failed', chatId };
      const mapped = BroadcastAdaptiveThrottle.mapErrorToSignal(err?.message);
      if (mapped) BroadcastAdaptiveThrottle.recordSignal(mapped.signal, { severity: mapped.severity });
      logger.warn('[BROADCAST:PV] fail', { ...meta, chatId, err: err.message });
      return { action: 'error', chatId, error: err.message };
    }
  }, `broadcast-pv:${job.id}`);
}

async function processTelegramBroadcast(job) {
  const meta = jobLogFields(job, { queueName: 'broadcast:telegram' });
  const start = Date.now();

  return correlationContext.runWithId(async () => {
    const { targets, message, photoFileId, options = {} } = job.data;
    const { delay = 100 } = options;

    logger.info('[BROADCAST:JOB] Starting', { ...meta, targetCount: targets?.length ?? 0 });

    const bot = global.botInstance;
    if (!bot) {
      throw new Error('Bot instance not available');
    }

    let sent = 0;
    let failed = 0;
    const errors = [];

    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];

      try {
        if (photoFileId) {
          await bot.telegram.sendPhoto(target, photoFileId, {
            caption: message,
            parse_mode: 'HTML',
          });
        } else {
          await bot.telegram.sendMessage(target, message, {
            parse_mode: 'HTML',
          });
        }
        sent++;
      } catch (err) {
        failed++;
        if (errors.length < 10) {
          errors.push({ target, error: err.message });
        }
      }

      if (delay > 0 && i < targets.length - 1) {
        await new Promise((r) => setTimeout(r, delay));
      }

      if ((i + 1) % 50 === 0) {
        await job.progress({ current: i + 1, total: targets.length, sent, failed });
      }
    }

    logger.info('[BROADCAST:JOB] Completed', {
      ...meta,
      sent,
      failed,
      total: targets.length,
      durationMs: Date.now() - start,
    });

    return {
      sent,
      failed,
      total: targets.length,
      sample_errors: errors,
    };
  }, `broadcast:${job.id}`);
}

async function processEmailBroadcast(job) {
  const meta = jobLogFields(job, { queueName: 'broadcast:email' });
  const start = Date.now();

  return correlationContext.runWithId(async () => {
    const { subject, message } = job.data;
    const UserEmailService = require('../../../services/UserEmailService');
    const result = await UserEmailService.broadcastToVerified(subject, message);

    logger.info('[BROADCAST:JOB] Email completed', {
      ...meta,
      sent: result.sent,
      failed: result.failed,
      total: result.total,
      durationMs: Date.now() - start,
    });
    return result;
  }, `email-broadcast:${job.id}`);
}

module.exports = {
  processTelegramBroadcast,
  processEmailBroadcast,
  processPvPromoDelivery,
};
