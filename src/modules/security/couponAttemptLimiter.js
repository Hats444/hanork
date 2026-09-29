'use strict';

/**
 * Limita tentativas de cupom inválido por usuário (anti brute-force de códigos).
 */
class CouponAttemptLimiter {
    constructor(opts = {}) {
        this.maxFails = opts.maxFails ?? 5;
        this.windowMs = opts.windowMs ?? 900000; // 15 min
        this.lockMs = opts.lockMs ?? 600000; // 10 min após exceder
        this._map = new Map(); // userId -> { fails: number[], lockedUntil: number }
    }

    check(userId) {
        const key = String(userId);
        const now = Date.now();
        const entry = this._map.get(key) || { fails: [], lockedUntil: 0 };
        if (entry.lockedUntil > now) {
            return {
                allowed: false,
                retryAfter: Math.ceil((entry.lockedUntil - now) / 1000),
            };
        }
        entry.fails = entry.fails.filter((t) => now - t < this.windowMs);
        this._map.set(key, entry);
        return { allowed: true };
    }

    recordFail(userId) {
        const key = String(userId);
        const now = Date.now();
        const entry = this._map.get(key) || { fails: [], lockedUntil: 0 };
        entry.fails = entry.fails.filter((t) => now - t < this.windowMs);
        entry.fails.push(now);
        if (entry.fails.length >= this.maxFails) {
            entry.lockedUntil = now + this.lockMs;
            entry.fails = [];
        }
        this._map.set(key, entry);
    }

    recordSuccess(userId) {
        this._map.delete(String(userId));
    }

    cleanup() {
        const now = Date.now();
        for (const [key, entry] of this._map) {
            if (entry.lockedUntil < now && entry.fails.every((t) => now - t > this.windowMs)) {
                this._map.delete(key);
            }
        }
    }
}

module.exports = CouponAttemptLimiter;
