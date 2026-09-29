'use strict';

exports.sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Dorme em pedaços — retorna false se shouldAbort() virar true */
exports.sleepInterruptible = async (ms, shouldAbort, stepMs = 1000) => {
  let left = Math.max(0, ms);
  while (left > 0) {
    if (typeof shouldAbort === 'function' && shouldAbort()) return false;
    const chunk = Math.min(stepMs, left);
    await exports.sleep(chunk);
    left -= chunk;
  }
  return true;
};

module.exports = exports;

