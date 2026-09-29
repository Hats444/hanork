'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;

function msUntilNextRun(syncHour, tzOffset) {
    const now = new Date();
    const localMinutes = (now.getUTCHours() + tzOffset) * 60 + now.getUTCMinutes();
    const targetMinutes = syncHour * 60;
    let diff = targetMinutes - localMinutes;
    if (diff <= 0) diff += 24 * 60;
    return diff * 60 * 1000;
}

function isEnabled() {
    const v = String(process.env.TELEGRAM_PROFILE_SYNC_ENABLED ?? '1').toLowerCase();
    return v !== '0' && v !== 'false' && v !== 'no';
}

async function runProfileSync(deps) {
    const { bot, log } = deps;
    if (!bot?.telegram) {
        log.warn('[PROFILE:SYNC] bot indisponível');
        return { ok: false, reason: 'no_bot' };
    }
    const { syncAllUsers } = require('../../services/TelegramProfileSyncService');
    return syncAllUsers(bot, { log });
}

function startTelegramProfileSyncScheduler(deps, options = {}) {
    if (!isEnabled()) {
        deps.log.info('[PROFILE:SYNC] desativado (TELEGRAM_PROFILE_SYNC_ENABLED=0)');
        return { initialTimeout: null, intervalHandle: null };
    }

    const syncHour = options.syncHour ?? parseInt(process.env.TELEGRAM_PROFILE_SYNC_HOUR || '4', 10);
    const tzOffset = options.tzOffset ?? parseInt(process.env.TELEGRAM_PROFILE_SYNC_TZ_OFFSET || '-3', 10);
    const wait = msUntilNextRun(syncHour, tzOffset);

    deps.log.info('[PROFILE:SYNC] Scheduler ativo', {
        horaLocal: `${syncHour}:00 (UTC${tzOffset >= 0 ? '+' : ''}${tzOffset})`,
        proximoEmMin: Math.round(wait / 60000),
    });

    let intervalHandle = null;
    const initialTimeout = setTimeout(() => {
        runProfileSync(deps).catch((e) => {
            deps.log.warn('[PROFILE:SYNC] erro:', e.message);
        });
        intervalHandle = setInterval(() => {
            runProfileSync(deps).catch((e) => {
                deps.log.warn('[PROFILE:SYNC] erro:', e.message);
            });
        }, DAY_MS);
    }, wait);

    return { initialTimeout, intervalHandle };
}

module.exports = {
    msUntilNextRun,
    runProfileSync,
    startTelegramProfileSyncScheduler,
    DAY_MS,
};
