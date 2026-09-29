'use strict';

const lastAt = new Map();

exports.shouldLog = (key, intervalMs = 5 * 60 * 1000) => {
  const now = Date.now();
  const prev = lastAt.get(key) || 0;
  if (now - prev < intervalMs) return false;
  lastAt.set(key, now);
  return true;
};

exports.reset = (key) => {
  if (key) lastAt.delete(key);
  else lastAt.clear();
};
