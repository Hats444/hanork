/**
 * Job: Report
 * Geração assíncrona de relatórios operacionais
 */
const logger = require('../../../config/logger');
const { connect: dbConnect } = require('../../../config/database-sqlite');
const { jobLogFields } = require('../jobLogContext');
const { correlationContext } = require('../../../infrastructure');
const { buildHanorkOpsReportCompact } = require('../../../services/ops/HanorkOpsReportBuilder');
const { deliverOpsReport } = require('../../../services/ops/deliverOpsReport');

function reportDedupeKey(date, adminChatId) {
  return `daily_report:sent:${date}:${adminChatId}`;
}

function wasReportSent(date, adminChatId) {
  try {
    const db = dbConnect();
    return !!db.prepare('SELECT key FROM kv_store WHERE key = ?').get(reportDedupeKey(date, adminChatId));
  } catch {
    return false;
  }
}

function markReportSent(date, adminChatId) {
  try {
    const db = dbConnect();
    db.prepare(
      `INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, '1', datetime('now'))`
    ).run(reportDedupeKey(date, adminChatId));
  } catch (e) {
    logger.warn('[REPORT] dedupe mark failed:', e.message);
  }
}

async function processDailyReport(job) {
  const meta = jobLogFields(job, { queueName: 'report:daily' });
  const start = Date.now();
  const { date, adminChatId } = job.data || {};

  if (!date || adminChatId == null) {
    logger.warn('[REPORT:JOB] Missing date or adminChatId', { ...meta, data: job.data });
    return { sent: false, error: 'missing_data' };
  }

  return correlationContext.runWithId(async () => {
    if (wasReportSent(date, adminChatId)) {
      logger.info('[REPORT:JOB] Skipped (dedupe)', meta);
      return { sent: false, skipped: true, date };
    }

    const bot = global.botInstance;
    if (!bot) return { sent: false };

    try {
      let botUsername = process.env.BOT_USERNAME || '';
      try {
        const me = await bot.telegram.getMe();
        botUsername = me.username || botUsername;
      } catch { /* ignore */ }

      const html = await buildHanorkOpsReportCompact({
        date,
        botUsername,
        label: `diário ${date}`,
      });
      await deliverOpsReport(bot.telegram, adminChatId, html, {
        singleMessage: true,
        requirePhoto: true,
      });
      markReportSent(date, adminChatId);

      logger.info('[REPORT:JOB] Ops report sent (menu photo)', {
        ...meta,
        durationMs: Date.now() - start,
      });
      return { sent: true, date };
    } catch (err) {
      logger.error('[REPORT:JOB] Failed', {
        ...meta,
        err: err.message,
        durationMs: Date.now() - start,
      });
      throw err;
    }
  }, `report-daily:${date}:${adminChatId}`);
}

async function processSalesReport(job) {
  const meta = jobLogFields(job, { queueName: 'report:sales' });
  const start = Date.now();

  return correlationContext.runWithId(async () => {
    const { startDate, endDate, format = 'summary' } = job.data;

    logger.info('[REPORT:JOB] Sales report', {
      ...meta,
      startDate,
      endDate,
      format,
      durationMs: Date.now() - start,
    });

    return { generated: true, format, period: { start: startDate, end: endDate } };
  }, `report-sales:${job.id}`);
}

module.exports = {
  processDailyReport,
  processSalesReport,
};
