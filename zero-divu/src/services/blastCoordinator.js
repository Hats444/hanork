'use strict';

const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const { IPC_DIR } = require('../ipc/paths');

const COORD_DIR = path.resolve(IPC_DIR, '..', 'wa-blast-coord');
const GROUPS_FILE = path.join(COORD_DIR, 'groups.json');

function sessionKey() {
  return process.env.WA_SESSION_ID || 'wa_a';
}

/** Lock/active por sessão WA — dual WA (wa_a + wa_b) não bloqueia um ao outro. */
function sessionCoordDir() {
  return path.join(COORD_DIR, sessionKey());
}

function activeFilePath() {
  return path.join(sessionCoordDir(), 'active.json');
}

function globalLockPath() {
  return path.join(sessionCoordDir(), 'global.lock');
}

function defaultMinGapMs() {
  const n = Number(process.env.CUSTOM_BLAST_MIN_GAP_MS);
  return Number.isFinite(n) && n > 0 ? n : 60 * 60 * 1000;
}

function readJson(file, fallback) {
  try {
    return fs.readJsonSync(file) || fallback;
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file, data) {
  fs.ensureDirSync(COORD_DIR);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeJsonSync(tmp, data, { spaces: 2 });
  fs.moveSync(tmp, file, { overwrite: true });
}

function pruneGroups(map, minGapMs) {
  const now = Date.now();
  const cutoff = now - Math.max(minGapMs, defaultMinGapMs()) * 2;
  for (const [jid, entry] of Object.entries(map)) {
    if (!entry?.at || entry.at < cutoff) delete map[jid];
  }
}

function msSincePost(group) {
  if (!group?.lastPostAt) return Infinity;
  return Date.now() - new Date(group.lastPostAt).getTime();
}

/** Grupo elegível para blast manual (coord compartilhado + lastPostAt local). */
function canBlastGroup(groupId, groupRow, minGapMs = defaultMinGapMs()) {
  const jid = String(groupId || '').trim();
  if (!jid) return false;

  const map = readJson(GROUPS_FILE, {});
  const lastCoord = map[jid]?.at || 0;
  if (Date.now() - lastCoord < minGapMs) return false;

  if (groupRow?.lastPostAt) {
    const since = msSincePost(groupRow);
    if (since < minGapMs) return false;
  }

  return true;
}

function recordBlastPost(groupId, jobId) {
  const jid = String(groupId || '').trim();
  if (!jid) return;
  const map = readJson(GROUPS_FILE, {});
  map[jid] = { at: Date.now(), jobId: jobId || null };
  pruneGroups(map, defaultMinGapMs());
  writeJsonAtomic(GROUPS_FILE, map);
}

function setBlastActive(jobId, meta = {}) {
  fs.ensureDirSync(sessionCoordDir());
  writeJsonAtomic(activeFilePath(), {
    jobId: String(jobId || ''),
    at: Date.now(),
    pid: process.pid,
    ...meta,
  });
}

function clearBlastActive(jobId) {
  const active = readJson(activeFilePath(), null);
  if (!active) return;
  if (jobId && active.jobId && active.jobId !== String(jobId)) return;
  try {
    fs.removeSync(activeFilePath());
  } catch {
    /* ignore */
  }
}

function isBlastActive(maxAgeMs = 30 * 60 * 1000) {
  const active = readJson(activeFilePath(), null);
  if (!active?.at) return false;
  return Date.now() - active.at < maxAgeMs;
}

function acquireGlobalBlastLock(jobId, ttlMs = 45 * 60 * 1000) {
  fs.ensureDirSync(sessionCoordDir());
  const lockPath = globalLockPath();
  try {
    if (fs.existsSync(lockPath)) {
      const cur = readJson(lockPath, null);
      if (cur?.at && Date.now() - cur.at < ttlMs) {
        return { ok: false, holder: cur.jobId || 'unknown' };
      }
    }
    const payload = { jobId: String(jobId), at: Date.now(), pid: process.pid };
    fs.writeJsonSync(lockPath, payload, { spaces: 2 });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function releaseGlobalBlastLock(jobId) {
  const lockPath = globalLockPath();
  try {
    const cur = readJson(lockPath, null);
    if (!cur) return;
    if (jobId && cur.jobId && cur.jobId !== String(jobId)) return;
    fs.removeSync(lockPath);
  } catch {
    /* ignore */
  }
}

function newBlastJobId() {
  return crypto.randomBytes(6).toString('hex');
}

module.exports = {
  defaultMinGapMs,
  canBlastGroup,
  recordBlastPost,
  setBlastActive,
  clearBlastActive,
  isBlastActive,
  acquireGlobalBlastLock,
  releaseGlobalBlastLock,
  newBlastJobId,
};
