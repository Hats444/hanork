'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ZERO_DIVU_CONFIG, envBool } = require('./config');
const { expandHome } = require('../../utils/sqliteJournal');

const HANORK_ROOT = path.resolve(__dirname, '../../..');
const DEFAULT_PRIMARY = 'wa_a';
const DEFAULT_SECONDARY = 'wa_b';

function manifestPath() {
  const fromEnv = process.env.WA_SESSIONS_MANIFEST;
  if (fromEnv && String(fromEnv).trim()) {
    const raw = String(fromEnv).trim();
    return raw.startsWith('./') || raw.startsWith('.\\')
      ? path.resolve(HANORK_ROOT, raw)
      : path.resolve(raw);
  }
  return path.join(HANORK_ROOT, 'config', 'wa-sessions.json');
}

function loadManifestRaw() {
  try {
    const p = manifestPath();
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function resolveProjectPath(raw) {
  if (!raw || !String(raw).trim()) return null;
  const s = String(raw).trim();
  if (s.startsWith('./') || s.startsWith('.\\')) return path.resolve(HANORK_ROOT, s);
  if (s.startsWith('~')) return expandHome(s);
  return path.resolve(s);
}

function primarySessionFallback() {
  return {
    sessionId: DEFAULT_PRIMARY,
    ipcDir: ZERO_DIVU_CONFIG.ipcDir,
    sessionDir: null,
    dbPath: ZERO_DIVU_CONFIG.zeroDivuDbPath,
    phone: null,
    role: 'primary',
    statusOnly: false,
    label: 'WA 1 (primário)',
    displayName: 'WA 1',
    cmdPrefix: 'wa',
  };
}

function resolveSessionEntry(sessionId, entry) {
  const dbFromSession =
    entry.dbPath != null
      ? resolveProjectPath(entry.dbPath)
      : entry.sessionDir
        ? path.join(resolveProjectPath(entry.sessionDir), 'zero-divu.db')
        : ZERO_DIVU_CONFIG.zeroDivuDbPath;

  const isSecondary = sessionId === DEFAULT_SECONDARY;
  return {
    sessionId,
    ipcDir: resolveProjectPath(entry.ipcDir) || ZERO_DIVU_CONFIG.ipcDir,
    sessionDir: entry.sessionDir ? resolveProjectPath(entry.sessionDir) : null,
    dbPath: dbFromSession,
    phone: entry.phone ?? null,
    role: entry.role || (isSecondary ? 'secondary' : 'primary'),
    statusOnly: Boolean(entry.statusOnly),
    enabled: entry.enabled !== false,
    label: entry.label || (isSecondary ? 'WA 2 (secundário)' : 'WA 1 (primário)'),
    displayName:
      entry.displayName || (isSecondary ? 'WA 2' : 'WA 1'),
    cmdPrefix: isSecondary ? 'wa2' : 'wa',
  };
}

function resolveSession(sessionId = DEFAULT_PRIMARY) {
  const manifest = loadManifestRaw();
  const entry = manifest?.sessions?.[sessionId];
  if (!entry) {
    if (sessionId === DEFAULT_PRIMARY) return primarySessionFallback();
    throw new Error(`Sessão WA desconhecida: ${sessionId}`);
  }
  return resolveSessionEntry(sessionId, entry);
}

function isDualWaEnabled() {
  return envBool('WA_DUAL_ENABLED', false);
}

function listSpawnableSessions() {
  const ids = [DEFAULT_PRIMARY];
  if (!isDualWaEnabled()) return ids;

  try {
    const secondary = resolveSession(DEFAULT_SECONDARY);
    if (secondary.enabled) ids.push(DEFAULT_SECONDARY);
  } catch {
    /* manifest incompleto */
  }
  return ids;
}

function ensureSessionDirs(sessionId) {
  const conf = resolveSession(sessionId);
  fs.mkdirSync(conf.ipcDir, { recursive: true });
  if (conf.sessionDir) fs.mkdirSync(conf.sessionDir, { recursive: true });
  return conf;
}

module.exports = {
  DEFAULT_PRIMARY,
  DEFAULT_SECONDARY,
  manifestPath,
  loadManifestRaw,
  resolveSession,
  isDualWaEnabled,
  listSpawnableSessions,
  ensureSessionDirs,
};
