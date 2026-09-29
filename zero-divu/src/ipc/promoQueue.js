'use strict';

const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const store = require('../utils/debouncedStore');
const pathResolver = require('../utils/pathResolver');
const { IPC_DIR } = require('./paths');
const logThrottle = require('../utils/logThrottle');
const { warningLog, successLog, infoLog } = require('../utils/logger');
const { appendWaOpsEvent } = require('../utils/opsMetrics');

const FILE = 'wa_promo_queue.json';
const POLL_MS = Number(process.env.PROMO_QUEUE_POLL_MS) || 45000;
const RETRY_MS = Number(process.env.PROMO_QUEUE_RETRY_MS) || 3 * 60 * 1000;
const MAX_PROMO_ATTEMPTS = Number(process.env.PROMO_QUEUE_MAX_ATTEMPTS) || 8;

let pollTimer = null;
const jobTimers = new Map();

function socketReady() {
  try {
    return require('../services/socketRegistry').isOnline();
  } catch {
    return false;
  }
}

function loadQueue() {
  return store.load(FILE, { jobs: [], version: 1 });
}

function saveQueue(data) {
  store.setCritical(FILE, data);
}

function promoRunResult(sent, skipped = 0, failed = 0, total = 0, extra = {}) {
  return { sent: sent || 0, skipped: skipped || 0, failed: failed || 0, total, ...extra };
}

function normalizePromoRunResult(value) {
  if (typeof value === 'number') {
    return promoRunResult(value);
  }
  return promoRunResult(
    value?.sent,
    value?.skipped,
    value?.failed,
    value?.total,
    { defer: value?.defer || null }
  );
}

function isAllGroupsSkipped(result) {
  const { sent, skipped, failed, total } = result;
  return sent === 0 && failed === 0 && skipped > 0 && total > 0 && skipped >= total;
}

async function runPromoJob(sock, job) {
  const cfg = require('../config/divulgacao');
  const grupos = require('../services/grupos');
  const statusMessage = require('../services/statusMessage');
  const { ensureProductBuyLink } = require('../utils/waPromoLink');
  let ids = grupos.getEligibleGroupIds();
  const maxBurst =
    cfg.HANORK_PROMO_MAX_GROUPS ?? cfg.PROMO_STATUS_MAX_GROUPS ?? 4;
  if (ids.length > maxBurst) {
    ids = ids.slice(0, maxBurst);
  }
  if (!ids.length) return promoRunResult(0, 0, 0, 0, { defer: 'no_groups' });

  const pause = require('../services/riskController').getPauseInfo();
  if (pause.hardPaused && !pause.softPaused) {
    warningLog(
      `Promo Hanork adiada — anti-ban (~${pause.remainingMin} min): ${job.productName || job.id}`
    );
    return promoRunResult(0, 0, 0, ids.length, { defer: 'anti_ban' });
  }

  let payload = null;
  const { sanitizeWaCaption } = require('../utils/statusCaptionSanitizer');
  const { resolveChatCaption } = require('../utils/chatCaption');
  let caption = ensureProductBuyLink(String(job.text || '').trim(), job.productId);
  caption = sanitizeWaCaption(caption, { productName: job.productName || null });
  const chatText = resolveChatCaption({
    chatText: job.chatText,
    statusText: caption,
    productId: job.productId ?? null,
    productName: job.productName || null,
  });

  if (job.imagePath && fs.existsSync(job.imagePath)) {
    payload = await statusMessage.buildFromLocal({
      type: 'image',
      file: job.imagePath,
      caption: '',
    });
  }

  if (!payload && job.productId != null) {
    const hanorkOverlay = require('../services/hanorkAutoOverlay');
    const productFile = hanorkOverlay.productImagePath(`auto-prod-${job.productId}.jpg`);
    if (productFile) {
      payload = await statusMessage.buildFromLocal({
        type: 'image',
        file: productFile,
        caption: '',
      });
    }
  }

  if (!payload && job.productId != null) {
    const menuPath = require('../services/menuPhotoFallback').nextMenuPhotoPath();
    if (menuPath) {
      payload = await statusMessage.buildFromLocal({
        type: 'image',
        file: menuPath,
        caption: '',
      });
    }
  }

  if (!payload && job.productId == null) {
    const menuPath = require('../services/menuPhotoFallback').nextMenuPhotoPath();
    if (menuPath) {
      payload = await statusMessage.buildFromLocal({
        type: 'image',
        file: menuPath,
        caption: '',
      });
    }
  }

  if (!payload) {
    payload = statusMessage.buildTextStatus(caption);
  }
  if (!payload) return promoRunResult(0, 0, 0, ids.length, { defer: 'no_payload' });

  const { autoPromoWithPaymentEnabled } = require('../services/groupPaymentPost');
  const withPayment = autoPromoWithPaymentEnabled();

  const stats = await statusMessage.broadcastToGroups(
    sock,
    payload,
    ids,
    (gid, ok) => require('../services/groupValidator').recordPostResult(gid, ok),
    caption,
    {
      source: 'hanork-promo',
      manual: true,
      campaign: 'hanork-promo',
      bypassRiskPause: false,
      allowGraceBypass: false,
      skipPostGuard: false,
      hanorkPromo: true,
      productId: job.productId ?? null,
      productName: job.productName || null,
      imagePath: job.imagePath || null,
      chatText,
      withPaymentAfterStatus: withPayment,
      paymentText: chatText || caption,
    }
  );

  if (!stats.sent && ids.length) {
    const antiBan = require('../services/antiBan');
    const limits = antiBan.getLimits();
    const pause = require('../services/riskController').getPauseInfo();
    if (pause.hardPaused && !pause.softPaused) {
      warningLog(
        `Promo Hanork: anti-ban ativo (~${pause.remainingMin} min) — ${job.productName || job.id}`
      );
    } else if (limits.posts >= limits.maxPosts) {
      warningLog(
        `Promo Hanork: cota horária (${limits.posts}/${limits.maxPosts} posts/h) — ${job.productName || job.id}`
      );
    } else {
      warningLog(
        `Promo Hanork: nenhum envio (${stats.skipped || 0} pulado, ${stats.failed || 0} falha) — ${job.productName || job.id}`
      );
    }
  }

  try {
    require('./eventBus').emitPostCycle({
      sent: stats.sent,
      total: ids.length,
      failed: stats.failed,
      skipped: stats.skipped,
      manual: true,
      campaign: 'hanork-promo',
    });
  } catch {
    /* ignore */
  }

  return promoRunResult(stats.sent, stats.skipped, stats.failed, ids.length);
}

exports.enqueue = (payload) => {
  const q = loadQueue();
  const job = {
    id: crypto.randomBytes(6).toString('hex'),
    status: 'pending',
    createdAt: new Date().toISOString(),
    attempts: 0,
    ...payload,
  };
  q.jobs.push(job);
  saveQueue(q);
  return job;
};

exports.listPending = (limit = 15) => {
  const q = loadQueue();
  return q.jobs
    .filter((j) => j.status === 'pending' || j.status === 'processing')
    .slice(0, limit)
    .map((j) => ({
      id: j.id,
      status: j.status,
      productId: j.productId,
      productName: j.productName,
      createdAt: j.createdAt,
      processAfter: j.processAfter || null,
      hasImage: Boolean(j.imagePath),
    }));
};

exports.pendingCount = () => exports.listPending(500).length;

exports.getNextScheduled = () => {
  const pending = loadQueue().jobs.filter(
    (j) => j.status === 'pending' || j.status === 'processing'
  );
  if (!pending.length) return null;
  const sorted = pending
    .slice()
    .sort(
      (a, b) =>
        new Date(a.processAfter || 0).getTime() - new Date(b.processAfter || 0).getTime()
    );
  const job = sorted[0];
  const afterMs = new Date(job.processAfter || 0).getTime();
  const mins = Math.max(0, Math.round((afterMs - Date.now()) / 60000));
  return {
    id: job.id,
    productName: job.productName || null,
    productId: job.productId || null,
    processAfter: job.processAfter || null,
    minsUntil: mins,
    ready: mins <= 0,
  };
};

exports.enqueuePromo = async (opts = {}) => {
  const text = String(opts.text || '').trim();
  if (!text) return { ok: false, error: 'empty_text' };

  if (opts.idempotencyKey) {
    const q = loadQueue();
    const dup = q.jobs.find(
      (j) => j.idempotencyKey === opts.idempotencyKey && j.status !== 'failed'
    );
    if (dup) {
      return {
        ok: true,
        duplicate: true,
        jobId: dup.id,
        pending: exports.pendingCount(),
      };
    }
  }

  let imagePath = null;
  if (opts.stagingName) {
    const inbox = path.join(IPC_DIR, 'inbox');
    fs.ensureDirSync(inbox);
    const src = path.join(inbox, path.basename(String(opts.stagingName)));
    if (fs.existsSync(src)) {
      const promoDir = path.join(pathResolver.getMediaDir(), 'promo');
      fs.ensureDirSync(promoDir);
      const dest = path.join(promoDir, `${Date.now()}-${path.basename(src)}`);
      await fs.move(src, dest);
      imagePath = dest;
    }
  } else if (opts.imagePath && fs.existsSync(opts.imagePath)) {
    imagePath = opts.imagePath;
  }

  const delayMs = Math.max(0, Number(opts.delayMs) || 0);
  const processAfter =
    delayMs > 0 ? new Date(Date.now() + delayMs).toISOString() : null;

  const job = exports.enqueue({
    text,
    chatText: opts.chatText || null,
    imagePath,
    productId: opts.productId ?? null,
    productName: opts.productName || null,
    adminId: opts.adminId ?? null,
    source: opts.source || 'hanork',
    idempotencyKey: opts.idempotencyKey || null,
    processAfter,
  });

  scheduleJobWake(job);

  return {
    ok: true,
    jobId: job.id,
    pending: exports.pendingCount(),
    hasImage: Boolean(imagePath),
    processAfter,
    delayMs,
  };
};

function pickNextPendingJob(jobs) {
  const now = Date.now();
  return jobs
    .filter((j) => j.status === 'pending')
    .filter((j) => {
      if (!j.processAfter) return true;
      const t = new Date(j.processAfter).getTime();
      return Number.isFinite(t) && t <= now;
    })
    .sort((a, b) => {
      const ta = new Date(a.processAfter || a.createdAt || 0).getTime();
      const tb = new Date(b.processAfter || b.createdAt || 0).getTime();
      return ta - tb;
    })[0];
}

async function tickPromoQueue() {
  try {
    if (require('./runtimeControls').isPostsPaused()) {
      return { processed: false, reason: 'posts_paused' };
    }
  } catch {
    /* boot */
  }
  if (!socketReady()) return { processed: false, reason: 'not_connected' };
  try {
    const registry = require('../services/socketRegistry');
    if (registry.isWarmingUp()) {
      return { processed: false, reason: 'warmup' };
    }
  } catch {
    /* boot */
  }
  const sock = require('../services/socketRegistry').get();
  if (!sock?.user) return { processed: false, reason: 'not_connected' };
  return exports.processNextIfAny(sock);
}

function scheduleJobWake(job) {
  if (!job?.id || job.status !== 'pending') return;
  const existing = jobTimers.get(job.id);
  if (existing) clearTimeout(existing);

  let delay = 0;
  if (job.processAfter) {
    const t = new Date(job.processAfter).getTime() - Date.now();
    delay = Math.max(0, t) + 1500;
  } else {
    delay = 3000;
  }

  const handle = setTimeout(() => {
    jobTimers.delete(job.id);
    tickPromoQueue().catch(() => {});
  }, Math.min(delay, 24 * 60 * 60 * 1000));
  if (handle.unref) handle.unref();
  jobTimers.set(job.id, handle);
}

function rescheduleAllPendingJobs() {
  const q = loadQueue();
  for (const j of q.jobs) {
    if (j.status === 'pending') scheduleJobWake(j);
  }
}

function recoverStuckJobs() {
  const q = loadQueue();
  let n = 0;
  for (const j of q.jobs) {
    if (j.status === 'processing') {
      j.status = 'pending';
      n++;
    }
  }
  if (n) {
    saveQueue(q);
    warningLog(`Fila promo: ${n} job(s) em "processing" revertido(s) para pendente`);
  }
}

exports.startScheduler = () => {
  if (pollTimer) return;
  recoverStuckJobs();
  pollTimer = setInterval(() => {
    tickPromoQueue().catch(() => {});
  }, POLL_MS);
  if (pollTimer.unref) pollTimer.unref();
  rescheduleAllPendingJobs();
  if (logThrottle.shouldLog('promo-scheduler-start', 120 * 1000)) {
    infoLog(
      `Fila promo Hanork: verificação a cada ${Math.round(POLL_MS / 1000)}s + timer por agendamento (~3 min)`
    );
  }
};

exports.stopScheduler = () => {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  for (const h of jobTimers.values()) clearTimeout(h);
  jobTimers.clear();
};

exports.processNextIfAny = async (sock) => {
  if (!sock?.user || !socketReady()) {
    return { processed: false, reason: 'not_connected' };
  }

  try {
    const registry = require('../services/socketRegistry');
    if (registry.isWarmingUp()) {
      return { processed: false, reason: 'warmup' };
    }
  } catch {
    /* boot */
  }

  try {
    if (require('./runtimeControls').isPostsPaused()) {
      return { processed: false, reason: 'posts_paused' };
    }
  } catch {
    /* boot */
  }

  const q = loadQueue();
  const job = pickNextPendingJob(q.jobs);
  if (!job) return { processed: false };

  job.status = 'processing';
  job.attempts = (job.attempts || 0) + 1;
  saveQueue(q);

  try {
    const runResult = normalizePromoRunResult(await runPromoJob(sock, job));
    const sent = runResult.sent;

    if (runResult.defer === 'no_groups') {
      job.status = 'completed';
      job.completedAt = new Date().toISOString();
      job.sent = 0;
      job.lastError = 'nenhum grupo elegível';
      saveQueue(q);
      pruneCompleted();
      if (logThrottle.shouldLog('promo-no-groups', 10 * 60 * 1000)) {
        infoLog(`Promo Hanork concluída — sem grupos elegíveis: ${job.productName || job.id}`);
      }
      return { processed: true, sent: 0, noGroups: true, jobId: job.id };
    }

    if (isAllGroupsSkipped(runResult)) {
      job.status = 'completed';
      job.completedAt = new Date().toISOString();
      job.sent = 0;
      job.skipped = runResult.skipped;
      job.lastError = 'todos os grupos pulados (postGuard/regras)';
      saveQueue(q);
      pruneCompleted();
      if (logThrottle.shouldLog(`promo-all-skip-${job.id}`, 10 * 60 * 1000)) {
        infoLog(
          `Promo Hanork concluída sem envio — ${runResult.skipped}/${runResult.total} grupo(s) pulado(s): ${job.productName || job.id}`
        );
      }
      appendWaOpsEvent({
        kind: 'skip',
        target: job.productName || job.id,
        detail: `${runResult.skipped}/${runResult.total} pulado(s)`,
        countermeasure: 'sem reagendamento',
      });
      return {
        processed: true,
        sent: 0,
        allSkipped: true,
        jobId: job.id,
        productName: job.productName,
      };
    }

    if (!sent && !socketReady()) {
      job.status = 'pending';
      job.attempts = Math.max(0, (job.attempts || 1) - 1);
      job.lastError = 'conexão instável — reagendado';
      job.processAfter = new Date(Date.now() + Math.min(RETRY_MS, 90000)).toISOString();
      saveQueue(q);
      scheduleJobWake(job);
      if (logThrottle.shouldLog('promo-offline-retry', 60 * 1000)) {
        warningLog(
          `Promo Hanork adiada — WhatsApp offline/reconectando: ${job.productName || job.id}`
        );
      }
      return { processed: false, reason: 'offline_retry', jobId: job.id };
    }
    if (sent > 0) {
      job.status = 'completed';
      job.completedAt = new Date().toISOString();
      job.sent = sent;
      saveQueue(q);
      pruneCompleted();
      successLog(
        `Promo Hanork enviada · ${job.productName || job.id} · ${sent} status${stats.paymentsSent ? ` + ${stats.paymentsSent} pagamento(s)` : ''}`
      );
      appendWaOpsEvent({
        kind: 'success',
        target: job.productName || job.id,
        detail: `${sent} grupo(s)`,
      });
      return { processed: true, sent, jobId: job.id, productName: job.productName };
    }

    job.status = 'pending';
    job.lastError = job.lastError || 'nenhum envio confirmado';
    job.processAfter = new Date(Date.now() + RETRY_MS).toISOString();
    saveQueue(q);

    if (job.attempts >= MAX_PROMO_ATTEMPTS) {
      job.status = 'failed';
      job.failedAt = new Date().toISOString();
      saveQueue(q);
      warningLog(
        `Promo Hanork falhou após ${job.attempts} tentativa(s): ${job.productName || job.id}`
      );
      appendWaOpsEvent({
        kind: 'fail',
        target: job.productName || job.id,
        detail: job.lastError || 'falha definitiva',
        countermeasure: 'job marcado failed',
      });
      return { processed: true, sent: 0, jobId: job.id, failed: true };
    }

    scheduleJobWake(job);
    if (logThrottle.shouldLog(`promo-retry-${job.id}`, 5 * 60 * 1000)) {
      warningLog(
        `Promo Hanork reagendada (~${Math.round(RETRY_MS / 60000)} min): ${job.productName || job.id} — tentativa ${job.attempts}/${MAX_PROMO_ATTEMPTS}`
      );
      appendWaOpsEvent({
        kind: 'retry',
        target: job.productName || job.id,
        detail: job.lastError || 'nenhum envio confirmado',
        countermeasure: `reagendada ~${Math.round(RETRY_MS / 60000)} min`,
      });
    }
    return { processed: true, sent: 0, jobId: job.id, retry: true };
  } catch (e) {
    job.status = job.attempts >= MAX_PROMO_ATTEMPTS ? 'failed' : 'pending';
    job.lastError = e?.message || String(e);
    if (job.status === 'pending') {
      job.processAfter = new Date(Date.now() + RETRY_MS).toISOString();
      scheduleJobWake(job);
    }
    saveQueue(q);
    throw e;
  }
};

function pruneCompleted() {
  const q = loadQueue();
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  q.jobs = q.jobs.filter((j) => {
    if (j.status === 'pending' || j.status === 'processing') return true;
    const t = new Date(j.completedAt || j.createdAt || 0).getTime();
    return t > cutoff;
  });
  saveQueue(q);
}

exports.processNow = async () => {
  const sock = require('../services/socketRegistry').get();
  if (!sock?.user) return { ok: false, error: 'not_connected', message: 'WhatsApp não conectado' };
  const out = await exports.processNextIfAny(sock);
  if (!out.processed) {
    return { ok: false, error: 'empty_queue', message: 'Fila promo vazia' };
  }
  const result = { ok: true, ...out };
  if ((out.sent ?? 0) === 0 && (out.noGroups || out.allSkipped)) {
    const postEligibility = require('../utils/postEligibility');
    result.message = postEligibility.buildBlockedMessage(postEligibility.summarizeActive(), {
      context: 'promo',
    });
  }
  return result;
};
