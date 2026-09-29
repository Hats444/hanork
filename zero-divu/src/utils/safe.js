'use strict';

const { errorLog, debugLog } = require('./logger');

function formatErr(e) {
  if (!e) return 'erro desconhecido';
  const msg = e.message || String(e);
  if (e.stack && process.env.ZERO_DIVU_DEBUG === '1') {
    return `${msg}\n${e.stack.split('\n').slice(0, 4).join('\n')}`;
  }
  return msg;
}

exports.formatErr = formatErr;

exports.run = async (label, fn, opts = {}) => {
  try {
    return await fn();
  } catch (e) {
    errorLog(`${label}: ${formatErr(e)}`);
    return opts.defaultValue;
  }
};

/** Falha sempre gera log com rótulo — nunca engole erro */
exports.runSilent = async (label, fn, defaultValue) => {
  try {
    return await fn();
  } catch (e) {
    errorLog(`${label}: ${formatErr(e)}`);
    return defaultValue;
  }
};

exports.runDebug = async (label, fn, defaultValue) => {
  try {
    return await fn();
  } catch (e) {
    debugLog(`${label}: ${formatErr(e)}`);
    return defaultValue;
  }
};

module.exports = exports;
