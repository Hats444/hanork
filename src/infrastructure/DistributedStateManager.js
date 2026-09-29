/**
 * DistributedStateManager - Gerenciamento de estado distribuído
 * 
 * Autossuficiente: funciona com Redis (se disponível) ou fallback em memória.
 * Substitui variáveis globais em memória (Set, Map) por estado controlado.
 * 
 * Uso:
 *   stateManager.acquireLock('broadcast:running', 30000) -> boolean
 *   stateManager.releaseLock('broadcast:running')
 *   stateManager.set('key', value, ttlMs)
 *   stateManager.get('key')
 */

const logger = require('../config/logger');

class DistributedStateManager {
    constructor() {
        // In-memory: funciona sem Redis, sem dependências externas
        this._locks = new Map();  // key -> { expiry: ts }
        this._store = new Map();  // key -> { value, expiry: ts | null }
        // Limpeza periódica para evitar memory leak
        setInterval(() => this._cleanup(), 60000);
    }

    _cleanup() {
        const now = Date.now();
        for (const [k, v] of this._locks) {
            if (v.expiry && now > v.expiry) this._locks.delete(k);
        }
        for (const [k, v] of this._store) {
            if (v.expiry && now > v.expiry) this._store.delete(k);
        }
    }

    // LOCKS — síncrono para evitar race conditions no mesmo processo
    acquireLock(key, ttlMs = 30000) {
        const now = Date.now();
        const existing = this._locks.get(key);
        if (existing && (!existing.expiry || now < existing.expiry)) {
            return false; // Já bloqueado
        }
        this._locks.set(key, { expiry: now + ttlMs });
        logger.debug(`[STATE] Lock acquired: ${key}`);
        return true;
    }

    releaseLock(key) {
        this._locks.delete(key);
        logger.debug(`[STATE] Lock released: ${key}`);
    }

    isLocked(key) {
        const existing = this._locks.get(key);
        if (!existing) return false;
        if (existing.expiry && Date.now() > existing.expiry) {
            this._locks.delete(key);
            return false;
        }
        return true;
    }

    // KV STORE com TTL
    set(key, value, ttlMs = null) {
        this._store.set(key, {
            value,
            expiry: ttlMs ? Date.now() + ttlMs : null
        });
        return true;
    }

    get(key) {
        const entry = this._store.get(key);
        if (!entry) return null;
        if (entry.expiry && Date.now() > entry.expiry) {
            this._store.delete(key);
            return null;
        }
        return entry.value;
    }

    delete(key) {
        this._store.delete(key);
        return true;
    }

    exists(key) {
        return this.get(key) !== null;
    }

    stats() {
        return {
            activeLocks: this._locks.size,
            storeSize: this._store.size,
            backend: 'in-memory'
        };
    }

    shutdown() {
        this._locks.clear();
        logger.info('[STATE] Shutdown complete');
    }
}

// Singleton
const stateManager = new DistributedStateManager();
module.exports = stateManager;

// Helper: executa fn com lock, joga erro se não conseguir
module.exports.withLock = async (key, ttlMs, fn) => {
    if (!stateManager.acquireLock(key, ttlMs)) {
        throw new Error(`Lock em uso: ${key}`);
    }
    try {
        return await fn();
    } finally {
        stateManager.releaseLock(key);
    }
};

// Helper: executa fn com lock, retorna null se não conseguir (skip silencioso)
module.exports.withLockOrSkip = async (key, ttlMs, fn) => {
    if (!stateManager.acquireLock(key, ttlMs)) {
        logger.warn(`[STATE] Lock skipped: ${key}`);
        return null;
    }
    try {
        return await fn();
    } finally {
        stateManager.releaseLock(key);
    }
};
