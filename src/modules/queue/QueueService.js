/**
 * Module: Queue Service
 * Sistema de filas com Bull + Redis
 * Processamento assíncrono de tarefas pesadas
 */
let Queue = null;
try { Queue = require('bull'); } catch (_) { /* bull não instalado — filas desativadas */ }
const logger = require('../../config/logger');
const { jobLogFields } = require('./jobLogContext');
const { correlationContext } = require('../../infrastructure');

// Redis config
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

class QueueService {
  constructor() {
    this.queues = {};
    this.processors = {};
  }

  /**
   * Inicializa uma fila
   */
  initQueue(name, concurrency = 1) {
    if (this.queues[name]) return this.queues[name];
    if (!Queue) {
      logger.warn(`[QUEUE:${name}] bull/ioredis não instalado — fila desativada (no-op)`);
      const noop = { add: async () => ({ id: 0 }), process: () => { }, on: () => { }, close: async () => { }, getWaitingCount: async () => 0, getActiveCount: async () => 0, getCompletedCount: async () => 0, getFailedCount: async () => 0, clean: async () => { }, pause: async () => { }, resume: async () => { } };
      this.queues[name] = noop;
      return noop;
    }

    const queue = new Queue(name, REDIS_URL, {
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000
        },
        removeOnComplete: 100,
        removeOnFail: 50
      }
    });

    // job.finished() em lote (broadcast PV) registra global:completed + global:failed por job
    if (typeof queue.setMaxListeners === 'function') {
      const floor = name === 'broadcast:pv' ? 256 : 32;
      queue.setMaxListeners(Math.max(floor, queue.getMaxListeners?.() || 10));
    }

    queue.on('completed', (job) => {
      logger.info(`[QUEUE:${name}] Job completed`, jobLogFields(job, { queueName: name }));
    });

    queue.on('failed', (job, err) => {
      if (err?.code === 'AI_COOLDOWN') return;
      logger.error(`[QUEUE:${name}] Job failed`, {
        ...jobLogFields(job, { queueName: name }),
        err: err?.message,
      });
    });

    queue.on('stalled', (job) => {
      logger.warn(`[QUEUE:${name}] Job stalled`, jobLogFields(job, { queueName: name }));
    });

    this.queues[name] = queue;
    return queue;
  }

  /**
   * Adiciona job à fila
   */
  async add(name, data, options = {}) {
    const queue = this.initQueue(name);
    const job = await queue.add(data, options);
    logger.info(`[QUEUE:${name}] Job added`, {
      ...jobLogFields(job, { queueName: name }),
      correlationId: correlationContext.getId(),
    });
    return job;
  }

  /**
   * Processa jobs da fila (registra no máximo uma vez por fila — evita duplicar entrega/relatório)
   */
  process(name, concurrency, handler) {
    if (this.processors[name]) {
      logger.warn(`[QUEUE:${name}] Processor já registrado — ignorando duplicata`);
      return this.queues[name];
    }
    const queue = this.initQueue(name);
    queue.process(concurrency, handler);
    this.processors[name] = handler;
    const verbose =
      process.env.LOG_VERBOSE === '1' || process.env.LOG_VERBOSE === 'true';
    if (verbose) {
      logger.info(`[QUEUE:${name}] Processor registered (concurrency: ${concurrency})`);
    }
    return queue;
  }

  /**
   * Obtém status da fila
   */
  async getStatus(name) {
    const queue = this.queues[name];
    if (!queue) return null;

    const [waiting, active, completed, failed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount()
    ]);

    return { waiting, active, completed, failed };
  }

  /**
   * Limpa fila
   */
  async clean(name, type, duration = 0) {
    const queue = this.queues[name];
    if (!queue) return;
    await queue.clean(duration, type);
  }

  /**
   * Pausa fila
   */
  async pause(name) {
    const queue = this.queues[name];
    if (queue) await queue.pause();
  }

  /**
   * Resume fila
   */
  async resume(name) {
    const queue = this.queues[name];
    if (queue) await queue.resume();
  }

  /** Aumenta teto de listeners antes de job.finished() em lote (broadcast PV). */
  bumpMaxListeners(name, extraListeners = 0) {
    const queue = this.queues[name];
    if (!queue?.setMaxListeners) return;
    const baseline = name === 'broadcast:pv' ? 256 : 32;
    const active =
      (queue.listenerCount?.('global:completed') || 0) +
      (queue.listenerCount?.('global:failed') || 0);
    const need = Math.max(baseline, active + extraListeners + 16);
    const cur = queue.getMaxListeners?.() || 10;
    if (need > cur) queue.setMaxListeners(need);
  }

  /**
   * Obtém job por id (dedupe de entrega)
   */
  async getJob(name, jobId) {
    const queue = this.queues[name] || this.initQueue(name);
    if (!queue?.getJob) return null;
    try {
      return await queue.getJob(jobId);
    } catch {
      return null;
    }
  }

  /**
   * Verifica se há job de entrega ativo ou aguardando
   */
  async hasPendingJob(name, jobId) {
    const job = await this.getJob(name, jobId);
    if (!job) return false;
    try {
      const state = await job.getState();
      return state === 'waiting' || state === 'active' || state === 'delayed';
    } catch {
      return false;
    }
  }

  /**
   * Fecha todas as filas
   */
  async closeAll() {
    for (const [name, queue] of Object.entries(this.queues)) {
      await queue.close();
      logger.info(`[QUEUE:${name}] Closed`);
    }
  }
}

// Singleton
module.exports = new QueueService();
