'use strict';

const crypto = require('crypto');

let currentOp = null;
let opCounter = 0;

function shortId() {
  opCounter += 1;
  return `${Date.now().toString(36)}-${opCounter.toString(36)}-${crypto.randomBytes(2).toString('hex')}`;
}

exports.begin = (type, meta = {}) => {
  currentOp = {
    id: shortId(),
    type,
    startedAt: Date.now(),
    ...meta,
  };
  return currentOp.id;
};

exports.end = () => {
  const op = currentOp;
  currentOp = null;
  return op;
};

exports.get = () => currentOp;

exports.withOp = async (type, meta, fn) => {
  const id = exports.begin(type, meta);
  try {
    return await fn(id);
  } finally {
    exports.end();
  }
};

exports.formatSkip = (groupId, reason, extra = {}) => {
  const labels = require('./groupLabels');
  const short = labels.shortId(groupId);
  const score = extra.score ?? extra.group?.score ?? '?';
  const rep = extra.trustScore ?? extra.reputation ?? '';
  const repTxt = rep !== '' ? ` · rep:${rep}` : '';
  const op = currentOp?.id ? ` · op:${currentOp.id.slice(-8)}` : '';
  const queue = extra.queue ? ` · fila:${extra.queue}` : '';
  return `${short} score:${score}${repTxt} — ${reason}${op}${queue}`;
};

module.exports = exports;
