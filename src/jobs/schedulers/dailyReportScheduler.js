'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;

function localReportDate(tzOffset) {
    const now = new Date();
    const localMs = now.getTime() + tzOffset * 3600000;
    return new Date(localMs).toISOString().slice(0, 10);
}

function msUntilNextRun(reportHour, tzOffset) {
    const now = new Date();
    const localMinutes = (now.getUTCHours() + tzOffset) * 60 + now.getUTCMinutes();
    const targetMinutes = reportHour * 60;
    let diff = targetMinutes - localMinutes;
    if (diff <= 0) diff += 24 * 60;
    return diff * 60 * 1000;
}

/**
 * Enfileira um job report:daily por admin (mesmo contrato do legado em bot.js).
 */
async function enqueueDailyReport(deps) {
    const { QueueService, adminIds, log, tzOffset } = deps;
    const date = localReportDate(tzOffset);
    const admins = adminIds || [];
    if (!admins.length) return { date, enqueued: 0 };

    let enqueued = 0;
    for (const adminId of admins) {
        try {
            await QueueService.add(
                'report:daily',
                { date, adminChatId: adminId },
                { jobId: `report-daily-${date}-${adminId}` }
            );
            enqueued++;
        } catch (e) {
            if (String(e.message || '').includes('Job') && String(e.message).includes('exists')) {
                log.info(`[REPORT] Job diário já enfileirado ${date} admin=${adminId}`);
                continue;
            }
            log.warn(`[REPORT] Fila report:daily indisponível admin=${adminId}:`, e.message);
        }
    }

    log.info('[REPORT] Relatório diário enfileirado', { date, admins: admins.length });
    return { date, enqueued };
}

/**
 * Agenda primeira execução + intervalo de 24h.
 * @returns {{ initialTimeout: NodeJS.Timeout, intervalHandle: NodeJS.Timeout|null }}
 */
function startDailyReportScheduler(deps, options = {}) {
    const reportHour = options.reportHour ?? parseInt(process.env.DAILY_REPORT_HOUR || '21', 10);
    const tzOffset = options.tzOffset ?? parseInt(process.env.DAILY_REPORT_TZ_OFFSET || '-3', 10);
    const depsWithTz = { ...deps, tzOffset };

    const wait = msUntilNextRun(reportHour, tzOffset);
    deps.log.info('[REPORT] Scheduler ativo', {
        horaLocal: `${reportHour}:00 (UTC${tzOffset >= 0 ? '+' : ''}${tzOffset})`,
        proximoEmMin: Math.round(wait / 60000),
    });

    let intervalHandle = null;
    const initialTimeout = setTimeout(() => {
        enqueueDailyReport(depsWithTz).catch((e) => {
            deps.log.warn('[REPORT] enqueueDailyReport:', e.message);
        });
        intervalHandle = setInterval(() => {
            enqueueDailyReport(depsWithTz).catch((e) => {
                deps.log.warn('[REPORT] enqueueDailyReport:', e.message);
            });
        }, DAY_MS);
    }, wait);

    return { initialTimeout, intervalHandle };
}

module.exports = {
    localReportDate,
    msUntilNextRun,
    enqueueDailyReport,
    startDailyReportScheduler,
    DAY_MS,
};
