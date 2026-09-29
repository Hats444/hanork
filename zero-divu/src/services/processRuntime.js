'use strict';

const store = require('../utils/debouncedStore');

const FILE = 'processRuntime.json';

function load() {
  return store.load(FILE, {
    bootCount: 0,
    reconnectCount: 0,
    lastBootAt: null,
    lastReconnectAt: null,
    lastBootType: 'fresh',
  });
}

function save(data) {
  store.setCritical(FILE, data);
}

exports.markFreshBoot = () => {
  const rt = load();
  rt.bootCount = (rt.bootCount || 0) + 1;
  rt.lastBootAt = new Date().toISOString();
  rt.lastBootType = 'fresh';
  save(rt);
  return rt;
};

exports.markReconnect = () => {
  const rt = load();
  rt.reconnectCount = (rt.reconnectCount || 0) + 1;
  rt.lastReconnectAt = new Date().toISOString();
  rt.lastBootType = 'reconnect';
  save(rt);
  return rt;
};

exports.get = () => load();

exports.isReconnectBoot = () => load().lastBootType === 'reconnect';

exports.shouldRunStartupCatchup = () => {
  const rt = load();
  if (rt.lastBootType === 'reconnect') return false;
  try {
    if (require('../services/runtimeRecovery').isRecoveryActive()) return false;
  } catch {
    /* ignore */
  }
  return true;
};

exports.clearBootType = () => {
  const rt = load();
  rt.lastBootType = 'fresh';
  save(rt);
};

module.exports = exports;
