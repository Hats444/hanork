'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const env = require('./environmentDetector');

function projectRoot() {
  return process.cwd();
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

exports.getProjectRoot = projectRoot;

exports.getDatabaseDir = () => {
  const dir = path.join(projectRoot(), 'src', 'database');
  return ensureDir(dir);
};

exports.getSessionDir = () => {
  const fromEnv = process.env.ZERO_DIVU_SESSION_DIR;
  if (fromEnv && String(fromEnv).trim()) {
    return ensureDir(path.resolve(String(fromEnv).trim()));
  }
  const cfg = safeCfg();
  const rel = cfg?.SESSION_DIR || './database/session';
  const dir = path.isAbsolute(rel) ? rel : path.join(projectRoot(), rel);
  return ensureDir(dir);
};

exports.getIpcDir = () => {
  const fromEnv = process.env.ZERO_DIVU_IPC_DIR;
  if (fromEnv && String(fromEnv).trim()) {
    return ensureDir(path.resolve(String(fromEnv).trim()));
  }
  try {
    return ensureDir(require('../ipc/paths').IPC_DIR);
  } catch {
    return ensureDir(path.join(projectRoot(), 'database', 'runtime', 'zero-ipc'));
  }
};

exports.getMediaDir = () => ensureDir(path.join(projectRoot(), 'src', 'media'));

exports.getLogsDir = () => ensureDir(path.join(projectRoot(), 'database', 'logs'));

exports.getTempDir = () => {
  const e = env.get();
  if (e.isTermux) return ensureDir(path.join(projectRoot(), 'database', 'tmp'));
  return ensureDir(path.join(projectRoot(), 'database', 'tmp'));
};

exports.getBackupDir = () => ensureDir(path.join(projectRoot(), 'database', 'backups'));

exports.getRuntimeDir = () => ensureDir(path.join(projectRoot(), 'database', 'runtime'));

exports.resolve = (...segments) => path.join(projectRoot(), ...segments);

exports.databaseFile = (name) => path.join(exports.getDatabaseDir(), name);

exports.runtimeFile = (name) => path.join(exports.getRuntimeDir(), name);

function safeCfg() {
  try {
    return require('../config/divulgacao');
  } catch {
    return null;
  }
}

module.exports = exports;
