'use strict';

/**
 * Rate limiting por comando (admin / financeiro / comum).
 */
class CommandRateLimiter {
    constructor(adminIds = []) {
        this.adminIds = adminIds;
        this.limits = {
            '/addproduto': [3, 60000],
            '/removeproduto': [5, 60000],
            '/editproduto': [10, 60000],
            '/produto': [10, 60000],
            '/listprodutos': [5, 60000],
            '/reativarproduto': [5, 60000],
            '/addcupom': [5, 60000],
            '/broadcast': [1, 300000],
            '/email': [3, 60000],
            '/flashsale': [3, 60000],
            '/carrinho': [10, 30000],
            '/checkout': [5, 30000],
            '/start': [5, 10000],
            '/help': [5, 10000],
            '/catalogo': [10, 10000],
            '/cupom': [8, 60000],
            '/hanork': [10, 60000],
            '/gpt': [3, 60000],
            '/ia': [3, 60000],
        };
        this.history = new Map();
    }

    check(userId, command) {
        if (this.adminIds.includes(userId)) return { allowed: true };
        const normalized = command.split(' ')[0].toLowerCase();
        const limit = this.limits[normalized];
        if (!limit) return { allowed: true };

        const [maxRequests, windowMs] = limit;
        const key = `${userId}:${normalized}`;
        const now = Date.now();

        if (!this.history.has(key)) {
            this.history.set(key, []);
        }
        const timestamps = this.history.get(key).filter(ts => now - ts < windowMs);

        if (timestamps.length >= maxRequests) {
            const oldest = timestamps[0];
            const retryAfter = Math.ceil((oldest + windowMs - now) / 1000);
            return { allowed: false, retryAfter, command: normalized };
        }

        timestamps.push(now);
        this.history.set(key, timestamps);
        return { allowed: true };
    }

    cleanup() {
        const now = Date.now();
        for (const [key, timestamps] of this.history) {
            const filtered = timestamps.filter(ts => now - ts < 600000);
            if (filtered.length === 0) {
                this.history.delete(key);
            } else {
                this.history.set(key, filtered);
            }
        }
    }
}

module.exports = CommandRateLimiter;
