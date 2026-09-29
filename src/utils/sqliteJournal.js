'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

/** WSL drvfs (/mnt/c) não suporta WAL de forma confiável — causa SQLITE_CANTOPEN. */
function isDrvfsPath(p) {
  return /\/mnt\/[a-z]\//i.test(String(p).replace(/\\/g, '/'));
}

function expandHome(p) {
  const s = String(p || '').trim();
  if (!s) return s;
  if (s === '~') return os.homedir();
  if (s.startsWith('~/') || s.startsWith('~\\')) {
    return path.join(os.homedir(), s.slice(2));
  }
  // Caminho Windows colado no .env enquanto roda no WSL (ex.: C:\Users\...)
  if (/^[A-Za-z]:[\\/]/.test(s) && process.platform !== 'win32') {
    const tail = s.replace(/^[A-Za-z]:[\\/]+/, '').replace(/\\/g, '/');
    const userDir = tail.startsWith('Users/') ? tail.slice('Users/'.length).split('/')[0] : null;
    if (userDir && os.userInfo().username === userDir) {
      return path.join(os.homedir(), tail.slice(`Users/${userDir}/`.length));
    }
    return path.join(os.homedir(), path.basename(tail) || '.hanork', 'hanork.db');
  }
  return s;
}

function isBrokenDbPath(p) {
  const s = String(p || '');
  return !s || /^C:Users/i.test(s) || s.includes('C:Users');
}

/**
 * Caminho efetivo do hanork.db.
 * WSL + projeto em /mnt/c → ~/.hanork/hanork.db (filesystem Linux nativo).
 */
function resolveHanorkDbPath(projectDbPath) {
  const fromEnv = expandHome(process.env.HANORK_DB_PATH);
  if (fromEnv && !isBrokenDbPath(fromEnv)) {
    return path.resolve(fromEnv);
  }

  const projectDefault = path.resolve(projectDbPath);
  if (isDrvfsPath(projectDefault)) {
    return path.join(os.homedir(), '.hanork', 'hanork.db');
  }
  return projectDefault;
}

/** Copia hanork.db do projeto (/mnt/c) para ~/.hanork na 1ª execução em WSL. */
function maybeMigrateDrvfsDb(projectDbPath, targetDbPath, log = () => {}) {
  const projectDb = path.resolve(projectDbPath);
  const targetDb = path.resolve(targetDbPath);
  if (!isDrvfsPath(projectDb) || projectDb === targetDb) return;
  if (!fs.existsSync(projectDb)) return;
  ensureDbDirectory(targetDb);
  if (fs.existsSync(targetDb)) return;
  fs.copyFileSync(projectDb, targetDb);
  log(`[SQLite] migrado ${projectDb} → ${targetDb} (WSL: evita drvfs)`);
}

function ensureDbDirectory(dbPath) {
  const dir = path.dirname(path.resolve(dbPath));
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function preferredJournalMode(dbPath) {
  const forced = String(process.env.SQLITE_JOURNAL_MODE || '').trim().toUpperCase();
  if (forced === 'WAL' || forced === 'DELETE' || forced === 'TRUNCATE') return forced;
  return isDrvfsPath(dbPath) ? 'DELETE' : 'WAL';
}

/**
 * Aplica journal_mode com fallback quando WAL falha (ex.: /mnt/c no WSL).
 * @returns {string} modo efetivo
 */
function applyJournalMode(database, dbPath, log = () => {}) {
  const primary = preferredJournalMode(dbPath);
  const chain = primary === 'WAL' ? ['WAL', 'DELETE'] : [primary, 'DELETE'];
  let lastErr;
  for (const mode of chain) {
    try {
      const row = database.pragma(`journal_mode = ${mode}`);
      const effective = Array.isArray(row) ? row[0]?.journal_mode || mode : mode;
      if (mode !== primary) {
        log(`[SQLite] journal_mode ${primary} indisponível em ${dbPath} — usando ${effective}`);
      }
      return String(effective || mode).toUpperCase();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('SQLite: falha ao definir journal_mode');
}

/** Remove sidecars WAL órfãos (comum após falha em /mnt/c). */
function removeWalSidecars(dbPath) {
  for (const ext of ['-wal', '-shm']) {
    try {
      const sidecar = `${path.resolve(dbPath)}${ext}`;
      if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
    } catch {
      /* outro processo ou permissão */
    }
  }
}

module.exports = {
  isDrvfsPath,
  expandHome,
  resolveHanorkDbPath,
  maybeMigrateDrvfsDb,
  ensureDbDirectory,
  preferredJournalMode,
  applyJournalMode,
  removeWalSidecars,
};
