'use strict';

const SmmConfig = require('../smmConfig');
const SmmServiceRepository = require('../repositories/smmServiceRepository');

const PREFIX = 'smm:cache:';
const KEYS = {
    stats: `${PREFIX}stats`,
    platforms: `${PREFIX}platforms`,
    version: `${PREFIX}version`,
};

async function getState() {
    try {
        const { getStateManager } = require('../../state');
        return getStateManager();
    } catch {
        return null;
    }
}

async function get(key) {
    const state = await getState();
    if (!state) return null;
    try {
        return await state.get(key);
    } catch {
        return null;
    }
}

async function set(key, value, ttlSec) {
    const state = await getState();
    if (!state) return;
    try {
        await state.set(key, value, ttlSec || SmmConfig.cacheTtlSec);
    } catch (_) { /* Redis opcional em dev */ }
}

async function invalidateAll() {
    const state = await getState();
    if (!state) return;
    try {
        for (const k of Object.values(KEYS)) {
            await state.delete(k);
        }
        await state.set(KEYS.version, Date.now(), SmmConfig.cacheTtlSec);
    } catch (_) { /* ignore */ }
}

async function getStats() {
    const cached = await get(KEYS.stats);
    if (cached) return cached;

    const stats = {
        total: SmmServiceRepository.countAll(),
        active: SmmServiceRepository.countActive(),
        cached_at: Date.now(),
    };
    await set(KEYS.stats, stats);
    return stats;
}

async function getPlatforms() {
    const cached = await get(KEYS.platforms);
    if (cached) return cached;

    const platforms = SmmServiceRepository.listPlatforms();
    await set(KEYS.platforms, platforms);
    return platforms;
}

module.exports = {
    KEYS,
    getStats,
    getPlatforms,
    invalidateAll,
};
