'use strict';

/** Fila serial com concorrência limitada */
class JobQueue {
  constructor(concurrency = 1) {
    this.concurrency = concurrency;
    this.running = 0;
    this.queue = [];
  }

  add(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this._pump();
    });
  }

  _pump() {
    while (this.running < this.concurrency && this.queue.length) {
      const job = this.queue.shift();
      this.running++;
      Promise.resolve()
        .then(() => job.fn())
        .then(job.resolve, job.reject)
        .finally(() => {
          this.running--;
          this._pump();
        });
    }
  }
}

module.exports = { JobQueue };
