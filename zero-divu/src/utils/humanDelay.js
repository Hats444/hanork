'use strict';

const { randomInt } = require('./random');

/** Delay assimétrico — evita padrões fixos (60s, 120s…) */
function humanDelay(minMs, maxMs, opts = {}) {
  const min = Math.max(0, Number(minMs) || 0);
  const max = Math.max(min, Number(maxMs) || min);
  if (max <= min) return min;

  const range = max - min;
  const skew = opts.skew ?? 0.35;
  const r1 = Math.random();
  const r2 = Math.random();
  const biased = (r1 + r2) / 2;
  const tail = Math.random() < skew ? Math.random() * 0.25 : 0;
  const jitter = randomInt(-Math.floor(range * 0.08), Math.floor(range * 0.08));
  return Math.round(min + range * Math.min(1, biased + tail) + jitter);
}

function exponentialBackoff(baseMs, attempt, { maxMs = 24 * 60 * 60 * 1000, jitter = 0.25 } = {}) {
  const base = Math.max(1000, Number(baseMs) || 60000);
  const exp = Math.min(maxMs, base * 2 ** Math.max(0, attempt - 1));
  const spread = Math.floor(exp * jitter);
  return humanDelay(exp - spread, exp + spread, { skew: 0.2 });
}

function spreadOverWindow(count, minMs, maxMs) {
  if (count <= 1) return [humanDelay(minMs, maxMs)];
  const window = humanDelay(minMs, maxMs);
  const step = window / count;
  const out = [];
  for (let i = 0; i < count; i++) {
    const base = step * i;
    out.push(Math.round(base + humanDelay(0, step * 0.6)));
  }
  return out.sort((a, b) => a - b);
}

module.exports = { humanDelay, exponentialBackoff, spreadOverWindow };
