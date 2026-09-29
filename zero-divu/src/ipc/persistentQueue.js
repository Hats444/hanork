'use strict';

const crypto = require('crypto');
const store = require('../utils/debouncedStore');
const { exponentialBackoff } = require('../utils/humanDelay');

function fileFor(name) {
  return `queue_${name}.json`;
}

function loadQueue(name) {
  return store.load(fileFor(name), { jobs: [], version: 1 });
}

function saveQueue(name, data) {
  store.setCritical(fileFor(name), data);
}

function newId() {
  return crypto.randomBytes(8).toString('hex');
}

exports.enqueue = (name, type, payload, opts = {}) => {
  const q = loadQueue(name);
  const job = {
    id: newId(),
    type,
    payload,
    status: 'pending',
    attempts: 0,
    createdAt: new Date().toISOString(),
    nextRetryAt: null,
    lockState: null,
    maxAttempts: opts.maxAttempts || 5,
    ...opts,
  };
  q.jobs.push(job);
  saveQueue(name, q);
  return job;
};

exports.enqueueUnique = (name, type, payload, keyField, opts = {}) => {
  const q = loadQueue(name);
  const key = payload?.[keyField];
  if (key) {
    const dup = q.jobs.find(
      (j) =>
        j.payload?.[keyField] === key &&
        j.status !== 'failed' &&
        j.status !== 'completed'
    );
    if (dup) return null;
  }
  return exports.enqueue(name, type, payload, opts);
};

exports.claimNext = (name) => {
  const q = loadQueue(name);
  const now = Date.now();
  const job = q.jobs.find(
    (j) =>
      j.status === 'pending' ||
      (j.status === 'retry' && j.nextRetryAt && new Date(j.nextRetryAt).getTime() <= now)
  );
  if (!job) return null;
  job.status = 'processing';
  job.processingState = 'worker';
  job.lockState = { at: new Date().toISOString(), owner: `pid:${process.pid}` };
  saveQueue(name, q);
  return job;
};

/** Reserva job para execução inline (evita dupla entrega pelo worker) */
exports.claimById = (name, jobId) => {
  const q = loadQueue(name);
  const now = Date.now();
  const job = q.jobs.find(
    (j) =>
      j.id === jobId &&
      (j.status === 'pending' ||
        (j.status === 'retry' && j.nextRetryAt && new Date(j.nextRetryAt).getTime() <= now))
  );
  if (!job) return null;
  job.status = 'processing';
  job.processingState = 'inline';
  job.lockState = { at: new Date().toISOString(), owner: `pid:${process.pid}` };
  saveQueue(name, q);
  return job;
};

exports.complete = (name, jobId) => {
  const q = loadQueue(name);
  q.jobs = q.jobs.filter((j) => j.id !== jobId);
  saveQueue(name, q);
};

exports.fail = (name, jobId, errMsg) => {
  const q = loadQueue(name);
  const job = q.jobs.find((j) => j.id === jobId);
  if (!job) return null;
  job.attempts = (job.attempts || 0) + 1;
  job.lastError = String(errMsg || '').slice(0, 200);
  const max = job.maxAttempts || 5;
  if (job.attempts >= max) {
    job.status = 'failed';
    job.failedAt = new Date().toISOString();
  } else {
    job.status = 'retry';
    const msg = String(errMsg || '');
    let delay = exponentialBackoff(120000, job.attempts);
    if (/limite-hora/i.test(msg)) delay = Math.max(delay, 55 * 60 * 1000);
    else if (/limite-grupos|sync-parcial/i.test(msg)) delay = Math.max(delay, 25 * 60 * 1000);
    else if (/preview-indisponivel/i.test(msg)) delay = Math.max(delay, 12 * 60 * 1000);
    job.nextRetryAt = new Date(Date.now() + delay).toISOString();
  }
  saveQueue(name, q);
  if (job.status === 'retry') {
    try {
      require('./checkpoints').record('before_retry', {
        queue: name,
        jobId: job.id,
        attempt: job.attempts,
        error: String(errMsg || '').slice(0, 80),
      });
      require('./queueManager').scheduleRetry(name, jobId);
    } catch {
      /* ignore */
    }
  }
  return job;
};

exports.reviveDueRetries = (name) => {
  const q = loadQueue(name);
  const now = Date.now();
  let revived = 0;
  for (const job of q.jobs) {
    if (job.status !== 'retry' || !job.nextRetryAt) continue;
    if (new Date(job.nextRetryAt).getTime() <= now) {
      job.status = 'pending';
      job.nextRetryAt = null;
      revived++;
    }
  }
  if (revived) saveQueue(name, q);
  return revived;
};

exports.list = (name) => loadQueue(name).jobs;
exports.count = (name) => loadQueue(name).jobs.length;

exports.reclaimProcessing = (name, olderThanMs = 10 * 60 * 1000) => {
  const q = loadQueue(name);
  const now = Date.now();
  let reclaimed = 0;
  for (const job of q.jobs) {
    if (job.status !== 'processing') continue;
    const at = job.lockState?.at ? new Date(job.lockState.at).getTime() : 0;
    if (now - at > olderThanMs) {
      job.status = 'retry';
      job.nextRetryAt = new Date().toISOString();
      reclaimed++;
    }
  }
  if (reclaimed) saveQueue(name, q);
  return reclaimed;
};

/** Jobs antigos com vários grupos violam 1 GP/wake — divide ou remove */
exports.sanitizeDeliveryJobs = (maxGroups = 1) => {
  const q = loadQueue('delivery');
  const next = [];
  let changed = 0;

  for (const job of q.jobs || []) {
    const ids = job.payload?.groupIds;
    if (!Array.isArray(ids) || ids.length <= maxGroups) {
      next.push(job);
      continue;
    }
    changed++;
    for (const gid of ids) {
      next.push({
        ...job,
        id: newId(),
        status: 'pending',
        lockState: null,
        processingState: null,
        payload: {
          ...job.payload,
          groupIds: [gid],
          cycleKey: `san-${gid.slice(0, 8)}-${Date.now().toString(36)}`,
        },
      });
    }
  }

  if (changed) {
    q.jobs = next;
    saveQueue('delivery', q);
  }
  return changed;
};

/** Remove convites duplicados, bloqueados e adia retries de limite no boot */
exports.sanitizeJoinJobs = (opts = {}) => {
  const maxKeep = Math.max(5, Number(opts.maxKeep) || 15);
  let bl = null;
  try {
    bl = require('./blacklist');
  } catch {
    /* ignore */
  }
  const sizeByCode = new Map();
  try {
    for (const item of require('./pendingInvites').list()) {
      if (item.code) sizeByCode.set(item.code, item.inviteSize || 0);
    }
  } catch {
    /* ignore */
  }

  const q = loadQueue('join');
  const seen = new Set();
  const candidates = [];
  let removed = 0;
  const deferMs = 25 * 60 * 1000;
  const minRetryAt = Date.now() + deferMs;

  for (const job of q.jobs || []) {
    const code = job.payload?.code;
    if (!code || job.status === 'failed') {
      removed++;
      continue;
    }
    if (bl?.isInviteBlocked?.(code)) {
      removed++;
      continue;
    }
    if (seen.has(code)) {
      removed++;
      continue;
    }
    seen.add(code);
    if (
      job.status === 'retry' &&
      /limite-grupos|limite-hora|sync-parcial|preview-indisponivel/i.test(String(job.lastError || ''))
    ) {
      const cur = job.nextRetryAt ? new Date(job.nextRetryAt).getTime() : 0;
      if (cur < minRetryAt) job.nextRetryAt = new Date(minRetryAt).toISOString();
    }
    candidates.push(job);
  }

  candidates.sort((a, b) => {
    const sa = sizeByCode.get(a.payload?.code) || 0;
    const sb = sizeByCode.get(b.payload?.code) || 0;
    return sb - sa;
  });

  const next = candidates.slice(0, maxKeep);
  if (candidates.length > maxKeep) removed += candidates.length - maxKeep;

  if (removed || next.length !== (q.jobs || []).length) {
    q.jobs = next;
    saveQueue('join', q);
  }
  return { removed, remaining: next.length };
};

exports.purgeStale = (name, maxAgeMs = 6 * 60 * 60 * 1000) => {
  const q = loadQueue(name);
  const cutoff = Date.now() - maxAgeMs;
  const before = q.jobs.length;
  q.jobs = q.jobs.filter((j) => {
    const created = j.createdAt ? new Date(j.createdAt).getTime() : 0;
    if (j.status === 'processing' && created < cutoff) return false;
    if (j.status === 'failed') return false;
    if (j.status === 'pending' && created > 0 && created < cutoff) return false;
    return true;
  });
  if (q.jobs.length !== before) saveQueue(name, q);
  return before - q.jobs.length;
};

/** Remove jobs falhos antigos (economiza JSON da fila) */
exports.purgeFailed = (name, maxAgeMs = 24 * 60 * 60 * 1000) => {
  const q = loadQueue(name);
  const cutoff = Date.now() - maxAgeMs;
  const before = q.jobs.length;
  q.jobs = q.jobs.filter((j) => {
    if (j.status !== 'failed') return true;
    const at = j.failedAt
      ? new Date(j.failedAt).getTime()
      : j.createdAt
        ? new Date(j.createdAt).getTime()
        : 0;
    return !at || at >= cutoff;
  });
  if (q.jobs.length !== before) saveQueue(name, q);
  return before - q.jobs.length;
};

/** Mantém só 1 job pendente por groupId na fila delivery */
exports.dedupeDeliveryJobs = () => {
  const q = loadQueue('delivery');
  const seen = new Set();
  const next = [];
  let removed = 0;

  for (const job of [...(q.jobs || [])].reverse()) {
    const gid = job.payload?.groupIds?.[0];
    if (job.status === 'pending' && gid) {
      if (seen.has(gid)) {
        removed++;
        continue;
      }
      seen.add(gid);
    }
    next.unshift(job);
  }

  if (removed) {
    q.jobs = next;
    saveQueue('delivery', q);
  }
  return removed;
};

/** Remove jobs pendentes/em processamento (scheduler event-driven usa nextPostAt) */
exports.clearPendingDelivery = () => {
  const q = loadQueue('delivery');
  const before = q.jobs.length;
  q.jobs = q.jobs.filter((j) => j.status !== 'pending' && j.status !== 'processing');
  if (q.jobs.length !== before) saveQueue('delivery', q);
  return before - q.jobs.length;
};

/** Esvazia fila delivery por completo (modo event-driven) */
exports.clearAllDelivery = () => {
  const q = loadQueue('delivery');
  const n = q.jobs.length;
  if (n) {
    q.jobs = [];
    saveQueue('delivery', q);
  }
  return n;
};

/** Cancela jobs pendentes/retry que ainda referenciam um grupo que não existe mais */
exports.cancelJobsForGroup = (jid) => {
  if (!jid) return 0;
  let removed = 0;
  for (const name of ['delivery', 'cooldown', 'retry', 'join']) {
    const q = loadQueue(name);
    const before = q.jobs.length;
    q.jobs = q.jobs.filter((j) => {
      if (j.status === 'completed' || j.status === 'failed') return true;
      const p = j.payload || {};
      if (p.jid === jid) return false;
      if (p.gid === jid) return false;
      const ids = p.groupIds;
      if (Array.isArray(ids) && ids.includes(jid)) return false;
      return true;
    });
    if (q.jobs.length !== before) {
      removed += before - q.jobs.length;
      saveQueue(name, q);
    }
  }
  return removed;
};

/** Após vários reboots, evita acumular dezenas de maintenance-sweep idênticos */
exports.collapseDuplicateJobs = (name, type) => {
  const q = loadQueue(name);
  const active = (q.jobs || []).filter(
    (j) => j.type === type && (j.status === 'pending' || j.status === 'retry' || j.status === 'processing')
  );
  if (active.length <= 1) return 0;
  const keepId = active[0].id;
  const before = q.jobs.length;
  q.jobs = q.jobs.filter(
    (j) => j.type !== type || j.id === keepId || (j.status !== 'pending' && j.status !== 'retry' && j.status !== 'processing')
  );
  if (q.jobs.length !== before) saveQueue(name, q);
  return before - q.jobs.length;
};

module.exports = exports;
