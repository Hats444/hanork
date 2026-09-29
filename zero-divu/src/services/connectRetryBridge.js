'use strict';

/** Ponte leve: gracefulShutdown → connect.js sem dependência circular. */
let retryFn = null;

exports.register = (fn) => {
  retryFn = typeof fn === 'function' ? fn : null;
};

exports.requestRetry = (delayMs = 15000) => {
  if (!retryFn) return false;
  setTimeout(() => {
    try {
      retryFn();
    } catch {
      /* ignore */
    }
  }, Math.max(3000, delayMs));
  return true;
};
