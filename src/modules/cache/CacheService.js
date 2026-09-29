/**
 * CacheService — stub compatível (Redis opcional via stateManager)
 */
'use strict';

const stateManager = require('../../infrastructure/DistributedStateManager');

class CacheService {
    async stats() {
        const s = stateManager.stats();
        return { type: s.backend || 'in-memory', size: s.storeSize || 0 };
    }

    async get(key) {
        return stateManager.get(`cache:${key}`);
    }

    async set(key, value, ttlMs = 3600000) {
        return stateManager.set(`cache:${key}`, value, ttlMs);
    }

    async del(key) {
        return stateManager.delete(`cache:${key}`);
    }
}

module.exports = new CacheService();
