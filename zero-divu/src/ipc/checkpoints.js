'use strict';

const store = require('../utils/debouncedStore');

const FILE = 'checkpoints.json';
const MAX = 120;

exports.TYPES = [
  'before_delivery',
  'after_delivery',
  'before_retry',
  'before_shutdown',
  'after_join',
  'before_reconnect',
];

exports.record = (type, meta = {}) => {
  if (!exports.TYPES.includes(type)) return null;
  const entry = {
    type,
    at: new Date().toISOString(),
    pid: process.pid,
    ...meta,
  };
  store.updateCritical(FILE, (data) => {
    const list = Array.isArray(data?.history) ? data.history : [];
    list.push(entry);
    return {
      version: 1,
      last: entry,
      lastByType: { ...(data?.lastByType || {}), [type]: entry },
      history: list.slice(-MAX),
    };
  }, { version: 1, history: [], lastByType: {} });
  return entry;
};

exports.getLast = (type) => {
  const data = store.load(FILE, { lastByType: {} });
  return type ? data.lastByType?.[type] || null : data.last || null;
};

exports.load = () => store.load(FILE, { history: [], lastByType: {} });

module.exports = exports;
