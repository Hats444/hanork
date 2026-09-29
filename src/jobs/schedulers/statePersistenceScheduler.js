'use strict';

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

async function runStatePersistence(deps) {
    const { state, carrinhos, comprasPendentes, bannedUsers } = deps;
    await state.save(carrinhos, comprasPendentes, bannedUsers);
}

function startStatePersistenceScheduler(deps, options = {}) {
    const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    deps.log.info('[CRON] State persistence ON', { intervalMs });

    return setInterval(() => {
        runStatePersistence(deps).catch((e) => {
            deps.log.warn('state.save:', { detail: e.message });
        });
    }, intervalMs);
}

module.exports = {
    runStatePersistence,
    startStatePersistenceScheduler,
    DEFAULT_INTERVAL_MS,
};
