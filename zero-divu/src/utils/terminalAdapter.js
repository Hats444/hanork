'use strict';

const env = require('./environmentDetector');

let cached = null;

function detect() {
  const e = env.get();
  const term = process.env.TERM || '';
  const noColor = Boolean(process.env.NO_COLOR);
  const dumb = term === 'dumb' || !term;
  const supportsAnsi = !noColor && !dumb && process.stdout.isTTY !== false;

  let width = 80;
  try {
    width = process.stdout.columns || 80;
  } catch {
    /* ignore */
  }

  return {
    supportsAnsi,
    width: Math.max(40, Math.min(width, 120)),
    term,
    isTermux: e.isTermux,
    compact: e.isTermux || width < 70,
  };
}

exports.get = () => {
  if (!cached) cached = detect();
  return cached;
};

exports.useColors = () => exports.get().supportsAnsi;

exports.refresh = () => {
  cached = detect();
  return cached;
};

exports.truncate = (text, maxLen) => {
  const s = String(text ?? '');
  const limit = maxLen ?? exports.get().width - 4;
  if (s.length <= limit) return s;
  return `${s.slice(0, Math.max(0, limit - 1))}…`;
};

exports.formatRow = (label, value) => {
  const t = exports.get();
  const key = exports.truncate(label, t.compact ? 18 : 28);
  const val = exports.truncate(value, t.width - key.length - 6);
  return { key, val, compact: t.compact };
};

module.exports = exports;
