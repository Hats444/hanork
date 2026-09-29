'use strict';

const crypto = require('crypto');
const store = require('../utils/debouncedStore');

const FILE = 'deliveryDedup.json';
const WINDOW_MS = 6 * 60 * 60 * 1000;

function load() {
  return store.load(FILE, { deliveries: [] });
}

function save(data) {
  store.setCritical(FILE, data);
}

function hashDelivery(groupId, caption, mediaType) {
  const raw = `${groupId}|${(caption || '').slice(0, 80)}|${mediaType || 'text'}`;
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 24);
}

function prune(list) {
  const cutoff = Date.now() - WINDOW_MS;
  return (list || []).filter((d) => new Date(d.at).getTime() >= cutoff);
}

exports.wouldDuplicate = (groupId, caption, mediaType) => {
  try {
    const guard = require('./statusContentGuard');
    const hit = guard.wouldDuplicate({ groupId, caption, mediaType });
    return hit.blocked;
  } catch {
    const h = hashDelivery(groupId, caption, mediaType);
    const data = load();
    const recent = prune(data.deliveries);
    return recent.some((d) => d.hash === h && d.groupId === groupId);
  }
};

exports.record = (groupId, caption, mediaType) => {
  try {
    return require('./statusContentGuard').recordSuccessfulSend({
      groupId,
      caption,
      mediaType,
    });
  } catch {
    const h = hashDelivery(groupId, caption, mediaType);
    const entry = { hash: h, groupId, at: new Date().toISOString() };
    const data = load();
    data.deliveries = prune([...(data.deliveries || []), entry]);
    save(data);
    return entry;
  }
};

exports.checkAndRecord = (groupId, caption, mediaType) => {
  if (exports.wouldDuplicate(groupId, caption, mediaType)) {
    return { ok: false, reason: 'entrega duplicada recente' };
  }
  exports.record(groupId, caption, mediaType);
  return { ok: true };
};

module.exports = exports;
