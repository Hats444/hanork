'use strict';

const persistentQueue = require('./persistentQueue');
const { exponentialBackoff } = require('../utils/humanDelay');
const { infoLog, errorLog } = require('../utils/logger');
const logThrottle = require('../utils/logThrottle');
const bootQuiet = require('../utils/bootQuiet');

class QueueWorker {
  constructor(name, { concurrency = 1, payloadKey = null, intervalMs = 3000 } = {}) {
    this.name = name;
    this.concurrency = concurrency;
    this.payloadKey = payloadKey;
    this.intervalMs = intervalMs;
    this.processor = null;
    this.running = 0;
    this.timer = null;
    this.active = false;
  }

  setProcessor(fn) {
    this.processor = fn;
    return this;
  }

  enqueue(payload, type = 'job', opts = {}) {
    let qm = null;
    try {
      qm = require('./queueManager');
      if (qm.isFrozen() && !opts.force) return null;
    } catch {
      /* ignore */
    }

    let job;
    if (this.payloadKey && payload?.[this.payloadKey]) {
      job = persistentQueue.enqueueUnique(this.name, type, payload, this.payloadKey, opts);
    } else {
      job = persistentQueue.enqueue(this.name, type, payload, opts);
    }
    if (job && opts.schedule !== false) this.schedule(500);
    return job;
  }

  schedule(delayMs = this.intervalMs) {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.pump().catch((e) => errorLog(`Fila ${this.name}: ${e.message}`));
    }, delayMs);
    if (this.timer.unref) this.timer.unref();
  }

  async pump() {
    if (!this.processor || !this.active) return;

    let qm = null;
    try {
      qm = require('./queueManager');
      if (qm.isFrozen()) return;
    } catch {
      /* ignore */
    }

    while (this.running < this.concurrency) {
      if (qm?.isFrozen?.()) break;

      const job = persistentQueue.claimNext(this.name);
      if (!job) break;

      this.running++;
      qm?.trackJobStart?.();
      const started = Date.now();
      try {
        await this.processor(job.payload, job);
        persistentQueue.complete(this.name, job.id);
      } catch (e) {
        persistentQueue.fail(this.name, job.id, e.message);
        const soft =
          e?.softRetry ||
          /conexão estabilizando|WhatsApp offline|fora-horario|limite-grupos|limite-hora|sync-parcial|preview-indisponivel/i.test(
            e.message || ''
          );
        if (logThrottle.shouldLog(`queue-fail-${this.name}`, soft ? 120000 : 30000)) {
          if (soft) {
            infoLog(`Fila ${this.name} job ${job.id.slice(0, 6)}: ${e.message} (retry)`);
          } else {
            errorLog(`Fila ${this.name} job ${job.id.slice(0, 6)}: ${e.message}`);
          }
        }
      } finally {
        this.running--;
        qm?.trackJobEnd?.();
        try {
          require('./metrics').recordDelay(Date.now() - started);
          require('./metrics').recordDelivery(Date.now() - started);
        } catch {
          /* ignore */
        }
      }
    }

    if (!qm?.isFrozen?.() && persistentQueue.count(this.name) > 0) {
      this.schedule();
    }
  }

  start() {
    this.active = true;
    persistentQueue.reclaimProcessing(this.name);
    const pending = persistentQueue.count(this.name);
    if (pending > 0) {
      bootQuiet.bootInfo(infoLog, `Fila ${this.name}: ${pending} pendente(s)`);
    }
    this.schedule(800);
  }

  stop() {
    this.active = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  count() {
    return persistentQueue.count(this.name);
  }
}

module.exports = { QueueWorker };
