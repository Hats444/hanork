'use strict';

const crypto = require('crypto');
const fs = require('fs-extra');
const store = require('../utils/debouncedStore');
const { infoLog, skipLog } = require('../utils/logger');

const FILE = 'status_content_dedup.json';
const WINDOW_MS = 24 * 60 * 60 * 1000;
const PRODUCT_GROUP_COOLDOWN_MS = 12 * 60 * 60 * 1000;
const MAX_ENTRIES = 500;

function load() {
  return store.load(FILE, { entries: [], productLastAt: {} });
}

function save(data) {
  store.setCritical(FILE, data);
}

function prune(list) {
  const cutoff = Date.now() - WINDOW_MS;
  return (list || []).filter((e) => new Date(e.at).getTime() >= cutoff);
}

function normalizeCaption(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function imageFingerprint(imagePath) {
  if (!imagePath) return '';
  try {
    const stat = fs.statSync(imagePath);
    return `${pathBasename(imagePath)}:${stat.size}:${stat.mtimeMs}`;
  } catch {
    return String(imagePath);
  }
}

function pathBasename(p) {
  const s = String(p || '').replace(/\\/g, '/');
  return s.split('/').pop() || s;
}

function buildStatusHash(meta = {}) {
  const parts = [
    String(meta.productId ?? ''),
    normalizeCaption(meta.caption),
    imageFingerprint(meta.imagePath),
    String(meta.mediaType || 'text'),
  ];
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32);
}

function logStatusSend(meta, hash) {
  infoLog(
    `[STATUS_SEND] group=${meta.groupShort || meta.groupId || '?'} product=${meta.productId ?? '-'} hash=${hash} source=${meta.source || 'auto'}`
  );
}

exports.buildHash = buildStatusHash;

function findRecentProductGroupPost(recent, meta) {
  const productId = meta.productId;
  const groupId = meta.groupId;
  if (productId == null || !groupId) return null;
  return recent
    .filter((e) => e.productId === productId && e.groupId === groupId)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())[0];
}

exports.wouldDuplicate = (meta = {}) => {
  const hash = buildStatusHash(meta);
  const data = load();
  const recent = prune(data.entries);
  const groupId = meta.groupId || null;

  const productHit = findRecentProductGroupPost(recent, meta);
  if (productHit) {
    const since = Date.now() - new Date(productHit.at).getTime();
    if (since < PRODUCT_GROUP_COOLDOWN_MS) {
      skipLog(
        `[DUPLICATE_STATUS_BLOCKED] product=${meta.productId ?? '-'} group=${meta.groupShort || groupId || '?'} reason=product_group_cooldown last_at=${productHit.at}`
      );
      return {
        blocked: true,
        hash,
        reason: 'mesmo produto neste grupo nas últimas 12h',
        lastAt: productHit.at,
      };
    }
  }

  const hit = recent.find((e) => e.hash === hash && e.groupId === groupId);
  if (hit) {
    skipLog(
      `[DUPLICATE_STATUS_BLOCKED] product=${meta.productId ?? '-'} hash=${hash} last_at=${hit.at} group=${hit.groupShort || hit.groupId || '?'}`
    );
    return { blocked: true, hash, reason: 'conteúdo idêntico neste grupo nas últimas 24h', lastAt: hit.at };
  }
  return { blocked: false, hash };
};

exports.checkBeforeSend = (meta = {}) => {
  const hash = buildStatusHash(meta);
  logStatusSend(meta, hash);
  const dup = exports.wouldDuplicate(meta);
  if (dup.blocked) return { ok: false, hash, ...dup };
  return { ok: true, hash };
};

exports.recordSuccessfulSend = (meta = {}) => {
  const hash = meta.hash || buildStatusHash(meta);
  const entry = {
    hash,
    groupId: meta.groupId || null,
    groupShort: meta.groupShort || null,
    productId: meta.productId ?? null,
    source: meta.source || null,
    at: new Date().toISOString(),
  };

  const data = load();
  data.entries = prune([...(data.entries || []), entry]).slice(-MAX_ENTRIES);

  if (meta.productId != null) {
    data.productLastAt = data.productLastAt || {};
    data.productLastAt[String(meta.productId)] = entry.at;
  }

  save(data);
  infoLog(
    `[STATUS_POSTED] group=${meta.groupShort || meta.groupId || '?'} product=${meta.productId ?? '-'} hash=${hash}`
  );
  return entry;
};

exports.getProductLastAt = (productId) => {
  const data = load();
  return data.productLastAt?.[String(productId)] || null;
};

exports.sortProductsByRecency = (variacoes = []) => {
  const data = load();
  const lastAt = data.productLastAt || {};
  return [...variacoes].sort((a, b) => {
    const pa = a?.productId ?? extractTipoId(a);
    const pb = b?.productId ?? extractTipoId(b);
    const ta = pa != null ? new Date(lastAt[String(pa)] || 0).getTime() : 0;
    const tb = pb != null ? new Date(lastAt[String(pb)] || 0).getTime() : 0;
    if (ta !== tb) return ta - tb;
    return (pa || 0) - (pb || 0);
  });
};

function extractTipoId(v) {
  const m = String(v?.tipo || '').match(/^prod-(\d+)$/i);
  return m ? Number(m[1]) : null;
}
