/**
 * Distributed Lock - Redis-based locking
 * Previne race conditions entre workers/processos
 */
let Redis = null;
try { Redis = require('ioredis'); } catch (_) { /* ioredis não instalado — locks desativados */ }
const logger = require('../../config/logger');

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const DEFAULT_TTL = 300; // 5 minutos

class RedisLockUnavailableError extends Error {
  constructor(message = 'Redis lock unavailable (fail-closed)') {
    super(message);
    this.name = 'RedisLockUnavailableError';
    this.code = 'REDIS_LOCK_UNAVAILABLE';
  }
}

function isRedisFailClosedEnabled() {
  const flag = process.env.REDIS_FAIL_CLOSED_ENABLED;
  if (flag === '1' || flag === 'true') return true;
  if (flag === '0' || flag === 'false') return false;
  return process.env.NODE_ENV === 'production';
}

function failClosedLockError(resource) {
  logger.error(`[LOCK] Redis offline — fail-closed bloqueou lock em ${resource}`);
  return new RedisLockUnavailableError();
}

class DistributedLock {
  constructor() {
    this.redis = null;
    this.isReady = false;
    this.connect();
  }

  connect() {
    if (!Redis) {
      if (isRedisFailClosedEnabled()) {
        logger.error('[LOCK] ioredis não instalado — fail-closed ativo (locks indisponíveis)');
      } else {
        logger.warn('[LOCK] ioredis não instalado — locks desativados (fail open). Execute: npm install');
      }
      return;
    }
    try {
      this.redis = new Redis(REDIS_URL, {
        retryStrategy: (times) => Math.min(times * 100, 3000),
        maxRetriesPerRequest: 3,
        lazyConnect: true
      });

      this.redis.on('connect', () => {
        this.isReady = true;
        logger.info('[LOCK] Redis lock service connected');
      });

      this.redis.on('error', () => {
        this.isReady = false;
      });

      this.redis.connect().catch(() => {
        this.isReady = false;
      });

    } catch (e) {
      if (isRedisFailClosedEnabled()) {
        logger.error('[LOCK] Redis unavailable — fail-closed ativo');
      } else {
        logger.warn('[LOCK] Redis unavailable, locks will fail open');
      }
    }
  }

  /**
   * Adquire lock com retry
   * @param {string} resource - Identificador do recurso (ex: order:123)
   * @param {number} ttl - Tempo de vida em segundos
   * @param {number} retryDelay - Delay entre tentativas (ms)
   * @param {number} maxRetries - Máximo de tentativas
   * @returns {Promise<{release: Function, token: string}|null>}
   */
  async acquire(resource, ttl = DEFAULT_TTL, retryDelay = 100, maxRetries = 50) {
    if (!this.isReady || !this.redis) {
      if (isRedisFailClosedEnabled()) {
        throw failClosedLockError(resource);
      }
      logger.warn(`[LOCK] Redis offline, lock for ${resource} failed open`);
      return null; // Fail open - permite operação sem lock (degradado)
    }

    const token = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const key = `lock:${resource}`;

    for (let i = 0; i < maxRetries; i++) {
      try {
        // SET com NX (only if not exists) e EX (expire)
        const acquired = await this.redis.set(key, token, 'NX', 'EX', ttl);

        if (acquired === 'OK') {
          logger.debug(`[LOCK] Acquired ${resource} (token: ${token.slice(0, 8)})`);

          // Retorna função de release
          const release = async () => {
            try {
              // Só libera se o token for o mesmo (previne liberação de lock de outro processo)
              const current = await this.redis.get(key);
              if (current === token) {
                await this.redis.del(key);
                logger.debug(`[LOCK] Released ${resource}`);
                return true;
              }
              logger.warn(`[LOCK] Cannot release ${resource} - token mismatch (possible timeout)`);
              return false;
            } catch (e) {
              logger.error(`[LOCK] Error releasing ${resource}: ${e.message}`);
              return false;
            }
          };

          return { release, token };
        }
      } catch (e) {
        logger.error(`[LOCK] Error acquiring ${resource}: ${e.message}`);
      }

      if (i < maxRetries - 1) {
        await new Promise(r => setTimeout(r, retryDelay));
      }
    }

    logger.warn(`[LOCK] Failed to acquire ${resource} after ${maxRetries} retries`);
    if (isRedisFailClosedEnabled()) {
      throw failClosedLockError(resource);
    }
    return null;
  }

  /**
   * Verifica se lock está ativo (para debugging)
   */
  async isLocked(resource) {
    if (!this.isReady || !this.redis) return false;
    try {
      const exists = await this.redis.exists(`lock:${resource}`);
      return exists === 1;
    } catch (e) {
      return false;
    }
  }

  /**
   * Força liberação de lock (emergência apenas)
   */
  async forceRelease(resource) {
    if (!this.isReady || !this.redis) return false;
    try {
      await this.redis.del(`lock:${resource}`);
      logger.warn(`[LOCK] Force released ${resource}`);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Estende TTL de um lock
   */
  async extend(resource, token, additionalTtl) {
    if (!this.isReady || !this.redis) return false;
    try {
      const key = `lock:${resource}`;
      const current = await this.redis.get(key);
      if (current === token) {
        await this.redis.expire(key, additionalTtl);
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }
}

module.exports = new DistributedLock();
module.exports.RedisLockUnavailableError = RedisLockUnavailableError;
module.exports.isRedisFailClosedEnabled = isRedisFailClosedEnabled;
