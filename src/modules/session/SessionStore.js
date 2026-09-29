/**
 * SessionStore — stub (sessões via RedisState / StateManager)
 */
'use strict';

class SessionStore {
    async listActive() {
        try {
            const rs = require('../state').getRedisState();
            if (rs.useFallback) return rs.fallback?.size || 0;
            if (rs.redis?.keys) {
                const keys = await Promise.race([
                    rs.redis.keys('state:*'),
                    new Promise((resolve) => setTimeout(() => resolve([]), 2000)),
                ]);
                return keys.length;
            }
        } catch {
            /* ignore */
        }
        return 0;
    }
}

module.exports = new SessionStore();
