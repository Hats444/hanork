/**
 * RedisState.js - Persistência de estado temporário no Redis
 * Substitui Maps/Set em memória por Redis para escalabilidade horizontal
 */

let Redis = null;
try { Redis = require('ioredis'); } catch (_) { /* ioredis não instalado — modo fallback em memória */ }
const logger = require('../../config/logger');

/** Namespaces de checkout/sessão/wizard — sem fallback silencioso quando fail-closed (2.4). */
const CRITICAL_NAMESPACES = new Set([
    'cart',
    'pending_purchase',
    'applied_coupon',
    'aff_saldo',
    'add_prod',
    'edit_prod',
    'email_mode',
    'giveaway_mode',
    'support_mode',
    'broadcast',
    'user',
    'smm_wizard',
]);

class RedisStateUnavailableError extends Error {
    constructor(namespace, operation = 'access') {
        super(`Redis state unavailable (fail-closed): ${namespace}.${operation}`);
        this.name = 'RedisStateUnavailableError';
        this.code = 'REDIS_STATE_UNAVAILABLE';
        this.namespace = namespace;
        this.operation = operation;
    }
}

function isRedisStateFailClosedEnabled() {
    const flag = process.env.REDIS_STATE_FAIL_CLOSED_ENABLED;
    if (flag === '1' || flag === 'true') return true;
    if (flag === '0' || flag === 'false') return false;
    return false;
}

function parseRedisConnection() {
    const url = process.env.REDIS_URL;
    if (url && String(url).startsWith('redis://')) {
        try {
            const u = new URL(url);
            return {
                host: u.hostname || 'localhost',
                port: parseInt(u.port, 10) || 6379,
                password: u.password || process.env.REDIS_PASSWORD || undefined,
            };
        } catch {
            /* fall through */
        }
    }
    return {
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379,
        password: process.env.REDIS_PASSWORD || undefined,
    };
}

class RedisState {
    constructor() {
        // Fallback in-memory sempre disponível
        this.fallback = new Map();
        this.useFallback = true;
        this.redis = null;

        if (!Redis) {
            if (isRedisStateFailClosedEnabled()) {
                logger.error('[RedisState] ioredis não instalado — fail-closed ativo para namespaces críticos');
            } else {
                logger.warn('[RedisState] ioredis não instalado — usando fallback em memória. Execute: npm install');
            }
            return;
        }

        try {
            const conn = parseRedisConnection();
            this.redis = new Redis({
                host: conn.host,
                port: conn.port,
                password: conn.password,
                maxRetriesPerRequest: 3,
                enableReadyCheck: true,
                retryStrategy: (times) => Math.min(times * 50, 2000),
                reconnectOnError: (err) => {
                    const targetErrors = ['READONLY', 'ECONNREFUSED', 'ETIMEDOUT'];
                    return targetErrors.some(e => err.message.includes(e));
                }
            });

            this.redis.on('connect', () => {
                this.useFallback = false;
                logger.info('[RedisState] Connected');
            });
            this.redis.on('error', () => { this.useFallback = true; });
            this.redis.on('reconnecting', () => logger.warn('[RedisState] Reconnecting...'));
        } catch (e) {
            if (isRedisStateFailClosedEnabled()) {
                logger.error('[RedisState] Falha ao conectar Redis — fail-closed ativo: ' + e.message);
            } else {
                logger.warn('[RedisState] Falha ao conectar Redis: ' + e.message + ' — usando fallback em memória');
            }
            this.redis = null;
        }
    }

    _isCriticalNamespace(namespace) {
        return CRITICAL_NAMESPACES.has(String(namespace || ''));
    }

    _redisOperational() {
        return !!(this.redis && !this.useFallback);
    }

    _failClosedOrFallback(namespace, operation) {
        if (isRedisStateFailClosedEnabled() && this._isCriticalNamespace(namespace)) {
            logger.error(`[RedisState] fail-closed bloqueou ${operation} em ${namespace}`);
            throw new RedisStateUnavailableError(namespace, operation);
        }
        return true;
    }

    getStats() {
        return {
            connected: this._redisOperational(),
            failClosed: isRedisStateFailClosedEnabled(),
            useFallback: this.useFallback,
            fallbackEntries: this.fallback.size,
            criticalNamespaces: [...CRITICAL_NAMESPACES],
        };
    }

    // ============== MÉTODOS PÚBLICOS ==============

    /**
     * Define um valor no Redis com TTL
     * @param {string} namespace - Namespace para organização (ex: 'cart', 'session')
     * @param {string} key - Chave única
     * @param {any} value - Valor a ser armazenado
     * @param {number} ttlSeconds - TTL em segundos (default: 3600 = 1h)
     */
    async set(namespace, key, value, ttlSeconds = 3600) {
        const fullKey = this._key(namespace, key);
        const data = JSON.stringify(value);
        if (this.redis && !this.useFallback) {
            try {
                await this.redis.setex(fullKey, ttlSeconds, data);
                return true;
            } catch (err) {
                this.useFallback = true;
            }
        }
        this._failClosedOrFallback(namespace, 'set');
        this.fallback.set(fullKey, { value, expires: Date.now() + (ttlSeconds * 1000) });
        return true;
    }

    /**
     * Obtém um valor do Redis
     * @param {string} namespace
     * @param {string} key
     * @returns {any|null}
     */
    async get(namespace, key) {
        const fullKey = this._key(namespace, key);
        if (this.redis && !this.useFallback) {
            try {
                const data = await this.redis.get(fullKey);
                return data ? JSON.parse(data) : null;
            } catch (err) {
                this.useFallback = true;
            }
        }
        this._failClosedOrFallback(namespace, 'get');
        const entry = this.fallback.get(fullKey);
        if (entry && entry.expires > Date.now()) return entry.value;
        this.fallback.delete(fullKey);
        return null;
    }

    /**
     * Deleta um valor
     * @param {string} namespace
     * @param {string} key
     */
    async delete(namespace, key) {
        const fullKey = this._key(namespace, key);
        if (this.redis && !this.useFallback) {
            try {
                await this.redis.del(fullKey);
                this.fallback.delete(fullKey);
                return true;
            } catch (_) {
                this.useFallback = true;
            }
        }
        // Remoção é idempotente — não bloquear cancelamento de checkout se Redis oscilar
        if (!this._redisOperational() && this._isCriticalNamespace(namespace)) {
            logger.warn(`[RedisState] delete offline em ${namespace} — limpando fallback local`);
        }
        this.fallback.delete(fullKey);
        return true;
    }

    /**
     * Verifica se existe
     * @param {string} namespace
     * @param {string} key
     */
    async exists(namespace, key) {
        const fullKey = this._key(namespace, key);
        if (this.redis && !this.useFallback) {
            try { return await this.redis.exists(fullKey) === 1; } catch (_) { this.useFallback = true; }
        }
        this._failClosedOrFallback(namespace, 'exists');
        const entry = this.fallback.get(fullKey);
        return !!(entry && entry.expires > Date.now());
    }

    /**
     * Define TTL para uma chave existente
     * @param {string} namespace
     * @param {string} key
     * @param {number} ttlSeconds
     */
    async expire(namespace, key, ttlSeconds) {
        if (!this.redis || this.useFallback) return;
        const fullKey = this._key(namespace, key);
        try { await this.redis.expire(fullKey, ttlSeconds); } catch (_) { this.useFallback = true; }
    }

    /**
     * Obtém todas as chaves de um namespace
     * @param {string} namespace
     * @returns {string[]}
     */
    async keys(namespace) {
        const prefix = `state:${namespace}:`;
        if (this.redis && !this.useFallback) {
            try {
                const keys = await this.redis.keys(`${prefix}*`);
                return keys.map(k => k.replace(prefix, ''));
            } catch (_) { this.useFallback = true; }
        }
        this._failClosedOrFallback(namespace, 'keys');
        return Array.from(this.fallback.keys()).filter(k => k.startsWith(prefix)).map(k => k.replace(prefix, ''));
    }

    /**
     * Limpa todo um namespace
     * @param {string} namespace
     */
    async clearNamespace(namespace) {
        if (this.redis && !this.useFallback) {
            try {
                const keys = await this.redis.keys(`state:${namespace}:*`);
                if (keys.length > 0) await this.redis.del(...keys);
            } catch (_) { this.useFallback = true; }
        }
        const prefix = `state:${namespace}:`;
        for (const key of this.fallback.keys()) {
            if (key.startsWith(prefix)) this.fallback.delete(key);
        }
    }

    /**
     * Adiciona a um Set
     * @param {string} namespace
     * @param {string} key
     * @param {any} member
     * @param {number} ttlSeconds
     */
    async sadd(namespace, key, member, ttlSeconds = 3600) {
        const fullKey = this._key(namespace, key);
        const memberStr = JSON.stringify(member);
        if (this.redis && !this.useFallback) {
            try {
                await this.redis.sadd(fullKey, memberStr);
                await this.redis.expire(fullKey, ttlSeconds);
                return true;
            } catch (_) { this.useFallback = true; }
        }
        // Fallback usando Map
        {
            const setKey = `${fullKey}:set`;
            const set = this.fallback.get(setKey)?.value || new Set();
            set.add(memberStr);
            this.fallback.set(setKey, { value: set, expires: Date.now() + (ttlSeconds * 1000) });
            return true;
        }
    }

    /**
     * Verifica se membro existe no Set
     * @param {string} namespace
     * @param {string} key
     * @param {any} member
     */
    async sismember(namespace, key, member) {
        const fullKey = this._key(namespace, key);
        const memberStr = JSON.stringify(member);

        try {
            return await this.redis.sismember(fullKey, memberStr) === 1;
        } catch (err) {
            const setKey = `${fullKey}:set`;
            const set = this.fallback.get(setKey)?.value;
            return set ? set.has(memberStr) : false;
        }
    }

    /**
     * Obtém todos os membros de um Set
     * @param {string} namespace
     * @param {string} key
     */
    async smembers(namespace, key) {
        const fullKey = this._key(namespace, key);

        try {
            const members = await this.redis.smembers(fullKey);
            return members.map(m => JSON.parse(m));
        } catch (err) {
            const setKey = `${fullKey}:set`;
            const set = this.fallback.get(setKey)?.value;
            return set ? Array.from(set).map(m => JSON.parse(m)) : [];
        }
    }

    /**
     * Remove do Set
     * @param {string} namespace
     * @param {string} key
     * @param {any} member
     */
    async srem(namespace, key, member) {
        const fullKey = this._key(namespace, key);
        const memberStr = JSON.stringify(member);

        try {
            await this.redis.srem(fullKey, memberStr);
        } catch (err) {
            const setKey = `${fullKey}:set`;
            const set = this.fallback.get(setKey)?.value;
            if (set) set.delete(memberStr);
        }
    }

    /**
     * Adiciona a uma Lista (LPUSH)
     * @param {string} namespace
     * @param {string} key
     * @param {any} value
     * @param {number} ttlSeconds
     */
    async lpush(namespace, key, value, ttlSeconds = 3600) {
        const fullKey = this._key(namespace, key);
        const data = JSON.stringify(value);

        try {
            await this.redis.lpush(fullKey, data);
            await this.redis.expire(fullKey, ttlSeconds);
            return true;
        } catch (err) {
            // Fallback
            const listKey = `${fullKey}:list`;
            const list = this.fallback.get(listKey)?.value || [];
            list.unshift(value);
            this.fallback.set(listKey, { value: list, expires: Date.now() + (ttlSeconds * 1000) });
            return true;
        }
    }

    /**
     * Obtém range de uma Lista
     * @param {string} namespace
     * @param {string} key
     * @param {number} start
     * @param {number} end
     */
    async lrange(namespace, key, start = 0, end = -1) {
        const fullKey = this._key(namespace, key);

        try {
            const items = await this.redis.lrange(fullKey, start, end);
            return items.map(i => JSON.parse(i));
        } catch (err) {
            const listKey = `${fullKey}:list`;
            const list = this.fallback.get(listKey)?.value || [];
            return list.slice(start, end === -1 ? undefined : end + 1);
        }
    }

    /**
     * Define hash field
     * @param {string} namespace
     * @param {string} key
     * @param {string} field
     * @param {any} value
     * @param {number} ttlSeconds
     */
    async hset(namespace, key, field, value, ttlSeconds = 3600) {
        const fullKey = this._key(namespace, key);
        const data = JSON.stringify(value);

        try {
            await this.redis.hset(fullKey, field, data);
            await this.redis.expire(fullKey, ttlSeconds);
            return true;
        } catch (err) {
            const hashKey = `${fullKey}:hash`;
            const hash = this.fallback.get(hashKey)?.value || {};
            hash[field] = value;
            this.fallback.set(hashKey, { value: hash, expires: Date.now() + (ttlSeconds * 1000) });
            return true;
        }
    }

    /**
     * Obtém hash field
     * @param {string} namespace
     * @param {string} key
     * @param {string} field
     */
    async hget(namespace, key, field) {
        const fullKey = this._key(namespace, key);

        try {
            const data = await this.redis.hget(fullKey, field);
            return data ? JSON.parse(data) : null;
        } catch (err) {
            const hashKey = `${fullKey}:hash`;
            const hash = this.fallback.get(hashKey)?.value || {};
            return hash[field] || null;
        }
    }

    /**
     * Obtém todo o hash
     * @param {string} namespace
     * @param {string} key
     */
    async hgetall(namespace, key) {
        const fullKey = this._key(namespace, key);

        try {
            const hash = await this.redis.hgetall(fullKey);
            const result = {};
            for (const [field, value] of Object.entries(hash)) {
                result[field] = JSON.parse(value);
            }
            return result;
        } catch (err) {
            const hashKey = `${fullKey}:hash`;
            return this.fallback.get(hashKey)?.value || {};
        }
    }

    /**
     * Incrementa um contador
     * @param {string} namespace
     * @param {string} key
     * @param {number} amount
     * @param {number} ttlSeconds
     */
    async incrby(namespace, key, amount = 1, ttlSeconds = 3600) {
        const fullKey = this._key(namespace, key);

        try {
            const newVal = await this.redis.incrby(fullKey, amount);
            await this.redis.expire(fullKey, ttlSeconds);
            return newVal;
        } catch (err) {
            const entry = this.fallback.get(fullKey);
            const current = entry?.value || 0;
            const newVal = current + amount;
            this.fallback.set(fullKey, { value: newVal, expires: Date.now() + (ttlSeconds * 1000) });
            return newVal;
        }
    }

    // ============== MÉTODOS PRIVADOS ==============

    _key(namespace, key) {
        return `state:${namespace}:${key}`;
    }

    // ============== LIFECYCLE ==============

    async close() {
        if (this.redis) {
            await this.redis.quit();
            logger.info('[RedisState] Connection closed');
        }
    }
}

// Singleton
let instance = null;
module.exports = {
    RedisStateUnavailableError,
    isRedisStateFailClosedEnabled,
    CRITICAL_NAMESPACES,
    getInstance: () => {
        if (!instance) {
            instance = new RedisState();
        }
        return instance;
    },
    // Para testes
    resetInstance: () => {
        instance = null;
    }
};
