'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

function envBool(name, fallback = false) {
  const v = process.env[name];
  if (v == null || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(v).trim().toLowerCase());
}

const { resolveHanorkDbPath, expandHome } = require('../../utils/sqliteJournal');

const HANORK_ROOT = path.resolve(__dirname, '../../..');
const HANORK_DB_PATH = resolveHanorkDbPath(path.join(HANORK_ROOT, 'hanork.db'));

function resolveProjectPath(fromEnv, fallback) {
  if (fromEnv && String(fromEnv).trim()) {
    const raw = String(fromEnv).trim();
    if (raw.startsWith('./') || raw.startsWith('.\\')) {
      return path.resolve(HANORK_ROOT, raw);
    }
    return path.resolve(raw);
  }
  return fallback;
}

/** WSL: prefere ~/hanork em vez de /mnt/c/… (CRLF + IPC lento). */
function resolveWslNativePath(resolved) {
  if (process.platform !== 'linux') return resolved;
  const posix = String(resolved).replace(/\\/g, '/');
  if (!/^\/mnt\/[a-z]\//i.test(posix)) return resolved;
  const m = posix.match(/\/hanork\/(.+)$/i);
  if (!m?.[1]) return resolved;
  const native = path.join(os.homedir(), 'hanork', m[1]);
  try {
    if (fs.existsSync(native)) return native;
  } catch {
    /* ignore */
  }
  return resolved;
}

function resolveIpcDir() {
  const dir = resolveProjectPath(
    process.env.ZERO_DIVU_IPC_DIR,
    path.resolve(HANORK_ROOT, 'shared', 'zero-ipc')
  );
  return resolveWslNativePath(dir);
}

function resolveZeroRoot() {
  const root = resolveProjectPath(
    process.env.ZERO_DIVU_ROOT,
    path.resolve(HANORK_ROOT, 'zero-divu')
  );
  return resolveWslNativePath(root);
}

function resolveZeroDivuDbPath() {
  const fromEnv = expandHome(process.env.ZERO_DIVU_DB_PATH);
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(os.homedir(), '.zero-divu', 'zero-divu.db');
}

function useSharedHanorkDb() {
  return envBool('ZERO_DIVU_USE_HANORK_DB', false);
}

function isZeroDivuEnabled() {
  return envBool('ZERO_DIVU_ENABLED', false);
}

function getIpcToken() {
  const v = process.env.ZERO_IPC_TOKEN;
  return v != null && String(v).trim() ? String(v).trim() : null;
}

const ZERO_DIVU_CONFIG = {
  enabled: isZeroDivuEnabled(),
  ipcDir: resolveIpcDir(),
  zeroRoot: resolveZeroRoot(),
  hanorkDbPath: HANORK_DB_PATH,
  zeroDivuDbPath: resolveZeroDivuDbPath(),
  useSharedHanorkDb: useSharedHanorkDb(),
  commandTimeoutMs: Number(process.env.ZERO_IPC_CMD_TIMEOUT_MS) || 30000,
  pollMs: Number(process.env.ZERO_IPC_POLL_MS) || 500,
  ipcToken: getIpcToken(),
};

module.exports = {
  ZERO_DIVU_CONFIG,
  envBool,
  isZeroDivuEnabled,
  useSharedHanorkDb,
  getIpcToken,
  HANORK_DB_PATH,
};
