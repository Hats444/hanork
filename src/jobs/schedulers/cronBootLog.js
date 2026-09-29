'use strict';

/** Agrupa logs "[CRON] … ON" do boot em uma linha só (salvo LOG_VERBOSE). */

const items = [];
let flushed = false;

function verbose() {
  return process.env.LOG_VERBOSE === '1' || process.env.LOG_VERBOSE === 'true';
}

exports.logSchedulerOn = (log, message, ctx) => {
  if (!log || typeof log.info !== 'function') return;
  if (flushed || verbose()) {
    log.info(message, ctx);
    return;
  }
  items.push({ message: String(message || ''), ctx });
};

exports.flush = (log) => {
  if (!log || flushed || items.length === 0) return;
  flushed = true;
  const labels = items.map((i) => {
    const m = i.message.match(/\[CRON\]\s+(.+?)\s+ON/i);
    if (m) return m[1];
    return i.message.replace(/^\[[^\]]+\]\s*/, '').slice(0, 48);
  });
  log.info(`[CRON] ${items.length} agendadores ativos`, { jobs: labels.join(' · ') });
  items.length = 0;
};

exports.resetForTests = () => {
  items.length = 0;
  flushed = false;
};
