'use strict';

const fs = require('fs-extra');
const path = require('path');
const { execSync } = require('child_process');
const cfg = require('../config/divulgacao');
const { sleep } = require('../utils/sleep');
const { infoLog, warningLog, errorLog } = require('../utils/logger');

const GLOBAL_LOCK_PATH = path.join(process.cwd(), 'database', 'runtime', 'bot.lock');

function getMyIpcDir() {
  const v = process.env.ZERO_DIVU_IPC_DIR;
  if (!v || !String(v).trim()) return null;
  return path.resolve(String(v).trim());
}

function isScopedInstance() {
  return Boolean(getMyIpcDir());
}

function getLockPath() {
  const ipc = getMyIpcDir();
  if (ipc) return path.join(ipc, 'bot.lock');
  return GLOBAL_LOCK_PATH;
}

function readEnvValueFromProc(pid, key) {
  if (process.platform !== 'linux' || !pid) return null;
  try {
    const buf = fs.readFileSync(`/proc/${pid}/environ`);
    const prefix = `${key}=`;
    const idx = buf.indexOf(prefix);
    if (idx < 0) return null;
    const start = idx + prefix.length;
    const end = buf.indexOf(0, start);
    const val = (end >= 0 ? buf.slice(start, end) : buf.slice(start)).toString('utf8');
    return val || null;
  } catch {
    return null;
  }
}

function readPeerIpcDir(pid) {
  const raw = readEnvValueFromProc(pid, 'ZERO_DIVU_IPC_DIR');
  return raw ? path.resolve(raw) : null;
}

function isSameInstanceScope(pid) {
  const mine = getMyIpcDir();
  const peer = readPeerIpcDir(pid);
  if (mine) return peer === mine;
  return !peer;
}

function getForeignHeartbeat() {
  if (isScopedInstance()) return null;
  try {
    const hb = require('./processHeartbeat').load();
    if (!hb?.at || hb.pid === process.pid) return null;
    if (hb.stopping || hb.cleanExit) return null;
    const age = Date.now() - new Date(hb.at).getTime();
    const stale = (require('./processHeartbeat').getIntervalMs?.() ?? 30000) * 2.5;
    if (age > stale) return null;
    return hb;
  } catch {
    return null;
  }
}

function heartbeatStaleMs() {
  return (require('./processHeartbeat').getIntervalMs?.() ?? 30000) * 2.5;
}

function readLock() {
  const lockPath = getLockPath();
  try {
    if (!fs.existsSync(lockPath)) return null;
    return JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch {
    return null;
  }
}

function writeLock() {
  const lockPath = getLockPath();
  fs.ensureDirSync(path.dirname(lockPath));
  fs.writeFileSync(
    lockPath,
    JSON.stringify(
      {
        pid: process.pid,
        startedAt: new Date().toISOString(),
        cmd: process.argv.slice(1).join(' '),
        ipcDir: getMyIpcDir(),
        sessionId: process.env.WA_SESSION_ID || null,
      },
      null,
      2
    )
  );
}

function isAlive(pid) {
  if (!pid || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e?.code === 'EPERM';
  }
}

function killProcess(pid, signal = 'SIGTERM') {
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

async function killProcessGracefullyAsync(pid) {
  if (!pid || pid === process.pid) return false;
  if (!isAlive(pid)) return false;

  killProcess(pid, 'SIGTERM');
  for (let i = 0; i < 30; i++) {
    if (!isAlive(pid)) return true;
    await sleep(100);
  }

  killProcess(pid, 'SIGKILL');
  for (let i = 0; i < 15; i++) {
    if (!isAlive(pid)) return true;
    await sleep(100);
  }
  return !isAlive(pid);
}

function findConnectJsPids() {
  const mine = process.pid;
  const found = new Set();

  if (process.platform === 'win32') {
    try {
      const ps =
        'Get-CimInstance Win32_Process -Filter "name=\'node.exe\'" | ' +
        'Where-Object { $_.CommandLine -match \'connect\\.js\' -and $_.CommandLine -notmatch \'stop-bot|verify-spec|preflight\' } | ' +
        'Select-Object -ExpandProperty ProcessId';
      const out = execSync(`powershell -NoProfile -Command "${ps}"`, {
        encoding: 'utf8',
        timeout: 10000,
      });
      for (const line of out.split('\n')) {
        const pid = parseInt(String(line).trim(), 10);
        if (pid && pid !== mine && isSameInstanceScope(pid)) found.add(pid);
      }
    } catch {
      /* ignore */
    }
    return [...found];
  }

  const commands = [
    'pgrep -af "connect\\.js" 2>/dev/null',
    'ps -eo pid,args 2>/dev/null',
    'ps aux 2>/dev/null',
  ];

  for (const cmd of commands) {
    try {
      const out = execSync(cmd, { encoding: 'utf8', timeout: 8000 });
      for (const line of out.split('\n')) {
        if (!/connect\.js/i.test(line) || /grep|pgrep|verify-spec|preflight-bot|stop-bot/i.test(line)) {
          continue;
        }
        const pid = parseInt(String(line).trim().split(/\s+/)[0], 10);
        if (pid && pid !== mine && isSameInstanceScope(pid)) found.add(pid);
      }
      if (found.size) break;
    } catch {
      /* try next */
    }
  }

  return [...found];
}

async function killAllOthers(opts = {}) {
  if (cfg.SINGLE_INSTANCE_KILL_DUPES === false) return 0;

  const reason = opts.reason || 'duplicata';
  const waitMs = opts.waitMs ?? cfg.SINGLE_INSTANCE_SETTLE_MS ?? 3000;
  const targets = new Set(findConnectJsPids());

  const lock = readLock();
  if (lock?.pid && lock.pid !== process.pid && isAlive(lock.pid) && isSameInstanceScope(lock.pid)) {
    targets.add(lock.pid);
  }

  if (!targets.size) return 0;

  let evicted = 0;
  for (const pid of targets) {
    if (await killProcessGracefullyAsync(pid)) {
      evicted++;
      if (reason === '440') {
        infoLog(`Conflito 440: processo duplicado encerrado (PID ${pid})`);
      } else if (reason === 'preflight') {
        process.stderr.write(`[zero-divu] encerrando instância anterior (PID ${pid})\n`);
      } else {
        infoLog(`Processo duplicado encerrado (PID ${pid})`);
      }
    }
  }

  if (evicted && waitMs > 0) {
    await sleep(waitMs);
  }

  return evicted;
}

/** Reserva lock exclusivo para este PID — aborta se outro bot vivo */
exports.claimExclusive = async () => {
  if (cfg.SINGLE_INSTANCE_LOCK === false) return { ok: true, evicted: 0 };

  const lockPath = getLockPath();
  fs.ensureDirSync(path.dirname(lockPath));

  const stale = readLock();
  if (stale?.pid && stale.pid !== process.pid && !isAlive(stale.pid)) {
    try {
      fs.removeSync(lockPath);
    } catch {
      /* ignore */
    }
  }

  const evicted = await killAllOthers({ reason: 'boot', waitMs: cfg.SINGLE_INSTANCE_SETTLE_MS ?? 3000 });
  const waitMs = cfg.SINGLE_INSTANCE_WAIT_MS ?? 120000;
  await exports.waitUntilAlone(waitMs);

  const held = readLock();
  if (held?.pid && held.pid !== process.pid && isAlive(held.pid)) {
    errorLog(`Bot já em execução (PID ${held.pid}). Rode: npm run stop`);
    process.exit(1);
  }

  writeLock();

  const touch = setInterval(() => writeLock(), 15000);
  if (touch.unref) touch.unref();

  const release = () => {
    clearInterval(touch);
    exports.release();
  };
  process.once('exit', release);
  process.once('SIGINT', release);
  process.once('SIGTERM', release);

  if (evicted) {
    warningLog(`${evicted} instância(s) duplicada(s) encerrada(s) — causa comum do erro 440`);
    if (isScopedInstance()) {
      infoLog(`Lock por sessão: ${getMyIpcDir()}`);
    } else {
      warningLog('Use só UM comando: npm run bot OU npm start (não os dois)');
    }
  }

  return { ok: true, evicted };
};

/** @deprecated use claimExclusive */
exports.acquire = async () => exports.claimExclusive();

exports.evictDuplicates = async (reason = '440') => {
  const evicted = await killAllOthers({
    reason,
    waitMs: cfg.RECONNECT_440_DUPE_SETTLE_MS ?? 3000,
  });
  writeLock();
  return evicted;
};

exports.killAllOthers = killAllOthers;
exports.findConnectJsPids = findConnectJsPids;
exports.getLockPath = getLockPath;
exports.isScopedInstance = isScopedInstance;

exports.release = () => {
  try {
    const lockPath = getLockPath();
    const lock = readLock();
    if (lock?.pid === process.pid && fs.existsSync(lockPath)) {
      fs.removeSync(lockPath);
    }
  } catch {
    /* ignore */
  }
};

exports.touch = () => {
  if (cfg.SINGLE_INSTANCE_LOCK === false) return;
  writeLock();
};

exports.countOthers = () => findConnectJsPids().length;

/** Espera até não haver outro connect.js (máx. ~120s) */
exports.waitUntilAlone = async (maxMs = 120000) => {
  const deadline = Date.now() + maxMs;
  let killed = 0;
  let crossOsWarned = false;
  const scoped = isScopedInstance();

  while (Date.now() < deadline) {
    const others = findConnectJsPids();
    const foreignHb = scoped ? null : getForeignHeartbeat();

    if (!others.length && !foreignHb) {
      const lock = readLock();
      if (!lock?.pid || lock.pid === process.pid || !isAlive(lock.pid)) {
        return killed;
      }
    }

    if (others.length && cfg.SINGLE_INSTANCE_KILL_DUPES !== false) {
      killed += await killAllOthers({ reason: 'boot', waitMs: 2000 });
    } else if (foreignHb && !crossOsWarned) {
      crossOsWarned = true;
      warningLog(
        `Outra instância ativa (PID ${foreignHb.pid}) — se usa WSL e Windows ao mesmo tempo, pare a outra com npm run stop`
      );
    }

    if (!others.length && foreignHb) {
      const hbAge = Date.now() - new Date(foreignHb.at).getTime();
      if (hbAge >= heartbeatStaleMs()) {
        return killed;
      }
    }

    await sleep(500);
  }

  const remaining = findConnectJsPids().length;
  const foreignHb = scoped ? null : getForeignHeartbeat();
  if (remaining || foreignHb) {
    if (foreignHb && !remaining) {
      errorLog(
        `Bot ativo em outro ambiente (PID ${foreignHb.pid}) — WSL e Windows não compartilham processos. Pare o outro terminal ou feche instâncias do Cursor que rodem connect.js`
      );
    } else {
      errorLog(
        `${remaining || 1} bot(s) ainda rodando — rode npm run stop, aguarde 3s, npm run bot`
      );
    }
    process.exit(1);
  }

  return killed;
};

exports.getForeignHeartbeat = getForeignHeartbeat;

module.exports = exports;
