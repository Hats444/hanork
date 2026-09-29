'use strict';

const { logSchedulerOn } = require('./cronBootLog');
const { getLocalParts } = require('../../data/marketingWeekdayCalendar');

const CHECK_MS = Math.max(
    60000,
    parseInt(process.env.SALES_REF_DAILY_PROMO_CHECK_MS || String(15 * 60 * 1000), 10)
);

function promoHour() {
    return Math.min(23, Math.max(0, parseInt(process.env.SALES_REF_DAILY_PROMO_HOUR || '10', 10)));
}

function isInPromoWindow(now = new Date()) {
    const p = getLocalParts(now);
    const h = promoHour();
    return p.hour === h && p.minute < 45;
}

/**
 * 1 post/dia no canal @hanorkinfos — Hanork/SMM conforme calendário §2.2.
 */
async function runSalesRefDailyPromoCycle(deps) {
    if (!isInPromoWindow()) return { skipped: true, reason: 'outside_window' };

    const { SalesReferenceChannelService } = require('../../services/SalesReferenceChannelService');
    const service = new SalesReferenceChannelService({
        bot: deps.bot,
        dbRaw: deps.dbRaw,
        groupService: deps.groupService || null,
    });
    return service.postDailyPromo({ photosDir: deps.photosDir || deps.config?.CAMINHO_FOTOS || null });
}

function startSalesRefDailyPromoScheduler(deps, options = {}) {
    const checkMs = options.checkMs ?? CHECK_MS;
    logSchedulerOn(deps.log, '[CRON] Sales ref daily promo scheduler ON', {
        checkMs,
        hour: promoHour(),
    });

    const tick = async () => {
        try {
            await runSalesRefDailyPromoCycle(deps);
        } catch (e) {
            deps.log.error('Erro promo diária canal ref:', e.message);
        }
    };

    const intervalHandle = setInterval(tick, checkMs);
    setTimeout(tick, 30000);
    return intervalHandle;
}

module.exports = {
    runSalesRefDailyPromoCycle,
    startSalesRefDailyPromoScheduler,
    CHECK_MS,
    promoHour,
    isInPromoWindow,
};
