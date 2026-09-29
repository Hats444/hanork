'use strict';

exports.withTimeout = (promise, ms, label = 'operação') => {
  const timeout = Math.max(5000, Number(ms) || 120000);
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} excedeu ${Math.round(timeout / 1000)}s`)),
      timeout
    );
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
};

module.exports = exports;
