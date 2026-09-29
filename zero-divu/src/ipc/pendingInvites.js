'use strict';

const store = require('../utils/debouncedStore');
const { infoLog } = require('../utils/logger');

const FILE = 'pendingInvites.json';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ITEMS = 200;

function load() {
  const data = store.load(FILE, { queue: [] });
  if (!Array.isArray(data.queue)) data.queue = [];
  return data;
}

function save(data) {
  store.setCritical(FILE, data);
}

function normalize(entry) {
  const meta = entry.meta && typeof entry.meta === 'object' ? entry.meta : {};
  const inviteSize = Number(
    entry.inviteSize ?? meta.size ?? meta.inviteSize ?? 0
  );
  if (inviteSize > 0) {
    meta.size = inviteSize;
  }
  return {
    code: String(entry.code || ''),
    meta,
    inviteSize: inviteSize > 0 ? inviteSize : 0,
    at: entry.at || new Date().toISOString(),
    reason: entry.reason || 'fila',
  };
}

function prune(queue) {
  const now = Date.now();
  const seen = new Set();
  const out = [];

  for (const raw of queue) {
    const item = normalize(raw);
    if (!item.code || seen.has(item.code)) continue;
    const age = now - new Date(item.at).getTime();
    if (age > MAX_AGE_MS) continue;
    seen.add(item.code);
    out.push(item);
  }

  return out.slice(-MAX_ITEMS);
}

exports.list = () => prune(load().queue);

/** Maior número de membros primeiro; empate = mais antigo na fila */
exports.sortByMemberSize = (queue) => {
  const list = Array.isArray(queue) ? queue.map(normalize) : exports.list();
  return [...list].sort((a, b) => {
    const sa = a.inviteSize || 0;
    const sb = b.inviteSize || 0;
    if (sb !== sa) return sb - sa;
    return new Date(a.at).getTime() - new Date(b.at).getTime();
  });
};

exports.listForProcessing = () => exports.sortByMemberSize(exports.list());

exports.has = (code) => exports.list().some((q) => q.code === code);

exports.setInviteSize = (code, size) => {
  const n = Number(size);
  if (!code || !Number.isFinite(n) || n <= 0) return;
  const data = load();
  let changed = false;
  data.queue = data.queue.map((raw) => {
    if (raw.code !== code) return raw;
    changed = true;
    return normalize({ ...raw, inviteSize: n, meta: { ...(raw.meta || {}), size: n } });
  });
  if (changed) save(data);
};

exports.add = (code, meta = {}, reason = 'fila') => {
  if (!code) return;
  const data = load();
  const inviteSize = Number(meta.size ?? meta.inviteSize ?? 0);
  data.queue = prune([
    ...data.queue.filter((q) => q.code !== code),
    normalize({ code, meta, reason, inviteSize, at: new Date().toISOString() }),
  ]);
  save(data);
};

exports.remove = (code) => {
  if (!code) return;
  const data = load();
  const before = data.queue.length;
  data.queue = data.queue.filter((q) => q.code !== code);
  if (data.queue.length !== before) save(data);
};

exports.count = () => exports.list().length;

exports.flush = () => store.flush(FILE);

module.exports = exports;
