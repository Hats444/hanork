'use strict';

const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { isZeroDivuEnabled, ZERO_DIVU_CONFIG, getIpcToken } = require('./config');
const logger = require('../../config/logger');

let child = null;
let adoptedPid = null;
let stopping = false;
let starting = false;
let restartTimer = null;
let restartAttempts = 0;
let lastLockConflict = false;
let workerBootAt = 0;
let lastCrashKind = null;
let crashBurst = 0;
let crashBurstResetAt = 0;

const MARKER_NAME = 'hanork-worker.json';
const ANSI_RE = /\x1b\[[0-9;]*m/g;
const DEDUPE_WINDOW_MS = 2 * 60 * 1000;
const dedupeAt = new Map();
const waZeroLog = logger.child({ category: 'WA', module: 'ZERO' });

function ts() {
  return new Date().toLocaleTimeString('pt-BR', { hour12: false });
}

function lockPath() {
  return path.join(ZERO_DIVU_CONFIG.zeroRoot, 'database', 'runtime', 'bot.lock');
}

function markerPath() {
  return path.join(ZERO_DIVU_CONFIG.ipcDir, MARKER_NAME);
}

function statePath() {
  return path.join(ZERO_DIVU_CONFIG.ipcDir, 'state.json');
}

function isPidAlive(pid) {
  if (!pid || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e?.code === 'EPERM';
  }
}

function readJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readLock() {
  return readJson(lockPath());
}

function writeMarker(workerPid) {
  try {
    fs.mkdirSync(ZERO_DIVU_CONFIG.ipcDir, { recursive: true });
    fs.writeFileSync(
      markerPath(),
      JSON.stringify({
        hanorkPid: process.pid,
        workerPid: workerPid || null,
        startedAt: new Date().toISOString(),
      }),
      'utf8'
    );
  } catch {
    /* ignore */
  }
}

function clearMarker() {
  try {
    if (fs.existsSync(markerPath())) fs.unlinkSync(markerPath());
  } catch {
    /* ignore */
  }
}

function findLiveWorkerPid() {
  const lock = readLock();
  if (lock?.pid && isPidAlive(lock.pid)) return lock.pid;

  const state = readJson(statePath());
  if (state?.workerPid && isPidAlive(state.workerPid)) return state.workerPid;

  return null;
}

function preflightCleanup() {
  const marker = readJson(markerPath());
  if (marker?.hanorkPid && marker.hanorkPid !== process.pid && isPidAlive(marker.hanorkPid)) {
    console.warn(
      `[ZeroDivu] Outro Hanork (PID ${marker.hanorkPid}) já gerencia o WhatsApp — não spawnar`
    );
    return false;
  }

  const lock = readLock();
  if (lock?.pid && !isPidAlive(lock.pid)) {
    try {
      fs.unlinkSync(lockPath());
    } catch {
      /* ignore */
    }
  }

  if (child?.pid && isPidAlive(child.pid)) return true;

  if (
    marker?.hanorkPid === process.pid &&
    marker?.workerPid &&
    isPidAlive(marker.workerPid)
  ) {
    return true;
  }

  const live = findLiveWorkerPid();
  if (live) return true;

  if (process.env.ZERO_DIVU_SKIP_PREFLIGHT === '1') return true;

  const stopScript = path.join(ZERO_DIVU_CONFIG.zeroRoot, 'scripts', 'stop-bot.js');
  if (fs.existsSync(stopScript)) {
    try {
      execFileSync(process.execPath, [stopScript], {
        cwd: ZERO_DIVU_CONFIG.zeroRoot,
        env: {
          ...process.env,
          ZERO_DIVU_IPC_DIR: ZERO_DIVU_CONFIG.ipcDir,
        },
        stdio: 'ignore',
        timeout: 20000,
      });
    } catch {
      /* stop-bot pode sair 1 se nada estava rodando */
    }
  }

  return true;
}

function adoptExternalWorker(pid) {
  adoptedPid = pid;
  child = null;
  writeMarker(pid);
  console.log(
    `[ZeroDivu] Worker WhatsApp já ativo (PID ${pid}) — Hanork usa IPC (sem segundo connect.js)`
  );
  return { adopted: true, pid };
}

let _inviteLineBurst = 0;
let _inviteLineTimer = null;

function noteInviteBurst(line) {
  if (!/Convite (já na fila|enfileirado)/i.test(line)) return false;
  _inviteLineBurst++;
  if (!_inviteLineTimer) {
    _inviteLineTimer = setTimeout(() => {
      const n = _inviteLineBurst;
      _inviteLineBurst = 0;
      _inviteLineTimer = null;
      if (n > 2) {
        emitWaZero('INF', `Convites (boot): ${n} linha(s) agrupadas — detalhe com LOG_VERBOSE=1`);
      }
    }, 600);
  }
  return true;
}

function shouldSuppressWaLine(line) {
  const t = String(line || '').trim();
  if (!t) return true;
  if (noteInviteBurst(t)) return true;
  if (/^[▄█▀▀\s]+$/.test(t)) return true;
  if (/ESCANEIE O QR|QR salvo em|Se não aparecer acima|Primeiro login — escaneie/i.test(t)) return true;
  if (/Aparelhos conectados → Conectar/i.test(t)) return true;
  if (/^═+$/.test(t.replace(/\s/g, ''))) return true;
  // Banner/boas-vindas e blocos decorativos
  if (/^╔═+╗$|^╚═+╝$|^║\s+ZERO DIVU|^║\s+Divulgação inteligente/i.test(t)) return true;
  if (/^Inicialização$|^Verificação ao iniciar$|^─{5,}$/.test(t)) return true;
  if (/^•\s+/.test(t)) return true;
  return false;
}

function mapZeroLevel(levelRaw) {
  const lv = String(levelRaw || '').toUpperCase();
  if (lv === 'INFO') return 'INF';
  if (lv === 'AVISO' || lv === 'WARN' || lv === 'WARNING') return 'WRN';
  if (lv === 'ERRO' || lv === 'ERROR') return 'ERR';
  if (lv === 'OK' || lv === 'SUCCESS') return 'OK';
  return 'INF';
}

function shouldDedupeKey(key, windowMs) {
  const l = String(key || '').replace(ANSI_RE, '').trim();
  if (!l) return true;

  // Dedupe agressivo p/ linhas repetitivas (rate-limit / cache / etc.)
  if (/WhatsApp limitou consultas — usando lista em cache/i.test(l)) {
    const k = 'wa-limitou-consultas-cache';
    const now = Date.now();
    const prev = dedupeAt.get(k) || 0;
    if (now - prev < DEDUPE_WINDOW_MS) return true;
    dedupeAt.set(k, now);
    return false;
  }

  const k = l;
  const now = Date.now();
  const prev = dedupeAt.get(k) || 0;
  const win = typeof windowMs === 'number' ? windowMs : 15 * 1000;
  if (now - prev < win) return true;
  dedupeAt.set(k, now);
  return false;
}

function emitWaZero(levelShort, message) {
  const msg = String(message || '').trim();
  if (!msg) return;
  if (shouldDedupeKey(`wa-zero:${levelShort}:${msg}`)) return;

  if (levelShort === 'WRN') return waZeroLog.warn(msg);
  if (levelShort === 'ERR') return waZeroLog.error(msg);
  if (levelShort === 'OK') return waZeroLog.success(msg);
  return waZeroLog.info(msg);
}

function pipeWa(stream, out) {
  stream.on('data', (buf) => {
    const text = String(buf).replace(ANSI_RE, '');
    if (/Bot já em execução|bot\(s\) ainda rodando|Outra instância ativa/i.test(text)) {
      lastLockConflict = true;
    }

    for (const raw of text.split(/\r?\n/)) {
      const line = String(raw || '').trim();
      if (!line) continue;
      if (shouldSuppressWaLine(line)) continue;

      // Caso bugado vindo “pré-prefixado”: "[00:09:02] [WA] [00:09:02] ZERO DIVU INFO ..."
      const m0 = line.match(
        /^\[(\d{2}:\d{2}:\d{2})\]\s+\[WA\]\s+\[(\d{2}:\d{2}:\d{2})\]\s+ZERO DIVU\s+(\w+)\s+(.*)$/i
      );
      if (m0) {
        const lvl = mapZeroLevel(m0[3]);
        emitWaZero(lvl, m0[4]);
        continue;
      }

      // Linhas do zero-divu: "[23:54:53] ZERO DIVU INFO msg"
      const m = line.match(/^\[(\d{2}:\d{2}:\d{2})\]\s+ZERO DIVU\s+(\w+)\s+(.*)$/i);
      if (m) {
        const lvl = mapZeroLevel(m[2]);
        emitWaZero(lvl, m[3]);
        continue;
      }

      // Linhas antigas/sem timestamp: "ZERO DIVU INFO msg"
      const m2 = line.match(/^ZERO DIVU\s+(\w+)\s+(.*)$/i);
      if (m2) {
        const lvl = mapZeroLevel(m2[1]);
        emitWaZero(lvl, m2[2]);
        continue;
      }

      // Outras linhas do worker (raras): mantém como WA/ZERO info, sem “cores estranhas”
      noteWorkerCrash(line);
      if (!shouldDedupeKey(`wa-zero:raw:${line}`)) {
        waZeroLog.info(line);
      }
    }
  });
}

function noteWorkerCrash(text) {
  const t = String(text || '');
  if (/ENOMEM|not enough memory/i.test(t)) {
    lastCrashKind = 'enoom';
    return;
  }
  if (/invalid ELF header|better_sqlite3\.node/i.test(t)) {
    lastCrashKind = 'native';
    return;
  }
  if (/MODULE_NOT_FOUND|Cannot find module/i.test(t)) {
    lastCrashKind = 'module';
    return;
  }
  if (/Connection Closed|408|428|wa_unstable/i.test(t)) {
    lastCrashKind = 'wa_unstable';
  }
}

function preflightNativeModules(zeroRoot) {
  if (process.platform !== 'linux') return true;
  try {
    const verify = path.join(zeroRoot, 'scripts', 'verify-deps.js');
    if (fs.existsSync(verify)) {
      require('child_process').execFileSync(process.execPath, [verify], {
        cwd: zeroRoot,
        stdio: 'pipe',
        timeout: 15000,
      });
      return true;
    }
  } catch (e) {
    const out = String(e?.stdout || e?.stderr || e?.message || '');
    console.warn(
      `[ZeroDivu] Pré-voo falhou — dependências nativas do worker inválidas no WSL/Linux.`
    );
    if (/invalid ELF|better_sqlite3|qified|FALTANDO/i.test(out)) {
      console.warn(out.trim().split('\n').slice(-6).join('\n'));
    }
    console.warn(
      '[ZeroDivu] Corrija: bash scripts/setup-zero-divu-wsl.sh --copy && hanork-restart'
    );
    lastCrashKind = /invalid ELF|better_sqlite3/i.test(out) ? 'native' : 'module';
    return false;
  }
  return true;
}

function restartDelayMs() {
  const now = Date.now();
  if (now > crashBurstResetAt) {
    crashBurst = 0;
    crashBurstResetAt = now + 10 * 60 * 1000;
  }
  crashBurst += 1;

  let delay = Math.min(300000, 5000 * restartAttempts);

  if (lastCrashKind === 'enoom') {
    delay = Math.max(delay, 120000);
  } else if (lastCrashKind === 'native') {
    delay = Math.max(delay, 300000);
  } else if (lastCrashKind === 'module') {
    delay = Math.max(delay, 90000);
  } else if (lastCrashKind === 'wa_unstable') {
    delay = Math.max(delay, 45000);
  }

  if (crashBurst >= 5) {
    delay = Math.max(delay, 180000);
  }

  return delay;
}

function warnWslMountIfNeeded(zeroRoot) {
  if (!/\/mnt\//i.test(String(zeroRoot || ''))) return;
  if (process.env.ZERO_DIVU_WSL_MOUNT_WARN === '0') return;
  console.warn(
    `[ZeroDivu] AVISO: worker em disco Windows (${zeroRoot}) — pode causar ENOMEM/lentidão no WSL. ` +
      'Recomendado: copiar zero-divu para ~/hanork/zero-divu e definir ZERO_DIVU_ROOT no .env'
  );
}

function scheduleRestart(reason) {
  if (reason) noteWorkerCrash(reason);
  if (stopping || !isZeroDivuEnabled()) return;
  if (restartTimer) return;

  if (lastLockConflict) {
    const live = findLiveWorkerPid();
    if (live) {
      adoptExternalWorker(live);
      lastLockConflict = false;
      return;
    }
  }

  restartAttempts += 1;
  const delay = restartDelayMs();
  console.warn(
    `[ZeroDivu] Worker caiu (${reason}${lastCrashKind ? ` · ${lastCrashKind}` : ''}) — reiniciando em ${Math.round(delay / 1000)}s`
  );
  restartTimer = setTimeout(() => {
    restartTimer = null;
    child = null;
    adoptedPid = null;
    maybeStart();
  }, delay);
  if (restartTimer.unref) restartTimer.unref();
}

function sanitizeNodeOptions(env) {
  const opts = env.NODE_OPTIONS || '';
  if (!opts.includes('--localstorage-file')) return env;
  const cleaned = opts
    .replace(/--localstorage-file(?:=\S*)?/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { ...env, NODE_OPTIONS: cleaned };
}

function spawnWorker() {
  const zeroRoot = ZERO_DIVU_CONFIG.zeroRoot;
  warnWslMountIfNeeded(zeroRoot);
  const connectJs = path.join(zeroRoot, 'connect.js');
  lastLockConflict = false;
  adoptedPid = null;

  const sharedDb = ZERO_DIVU_CONFIG.useSharedHanorkDb;
  const workerDbPath = sharedDb ? ZERO_DIVU_CONFIG.hanorkDbPath : ZERO_DIVU_CONFIG.zeroDivuDbPath;
  const primaryConf = resolveSession(DEFAULT_PRIMARY);
  const baseEnv = sanitizeNodeOptions({
    ...process.env,
    HANORK_LOG_BG: process.env.HANORK_LOG_BG || '',
    ZERO_DIVU_IPC_DIR: ZERO_DIVU_CONFIG.ipcDir,
    HANORK_ZERO_WORKER: '1',
    HANORK_PARENT_PID: String(process.pid),
    ZERO_DIVU_NO_RESTART: '1',
    ZERO_DIVU_USE_HANORK_DB: sharedDb ? '1' : '0',
    ZERO_DIVU_STORAGE: 'sql',
    ZERO_DIVU_DB_PATH: workerDbPath,
    ...(sharedDb ? { HANORK_DB_PATH: ZERO_DIVU_CONFIG.hanorkDbPath } : {}),
    HANORK_INFOS_DIR: path.join(path.dirname(ZERO_DIVU_CONFIG.hanorkDbPath), 'infos'),
    ZERO_MAX_GROUPS: String(process.env.ZERO_MAX_GROUPS || '25'),
    BOT_USERNAME: process.env.BOT_USERNAME || process.env.HANORK_BOT_USERNAME || 'hanork_bot',
    HANORK_BOT_USERNAME: process.env.HANORK_BOT_USERNAME || process.env.BOT_USERNAME || 'hanork_bot',
    ZERO_DIVU_MULTI_SESSION: '1',
    WA_SESSION_ID: DEFAULT_PRIMARY,
    WA_DISPLAY_NAME: primaryConf.displayName || 'WA 1',
  });
  applyDualWaPeerEnv(baseEnv, primaryConf);

    child = spawn(process.execPath, [connectJs], {
    cwd: zeroRoot,
    env: baseEnv,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  pipeWa(child.stdout, process.stdout);
  pipeWa(child.stderr, process.stderr);

  child.once('spawn', () => {
    restartAttempts = 0;
    workerBootAt = Date.now();
    writeMarker(child.pid);
    const dbNote = sharedDb ? 'hanork.db (compartilhado)' : workerDbPath;
    logger.info(`WhatsApp worker iniciado → ${zeroRoot} (PID ${child.pid}, DB: ${dbNote})`, {
      category: 'HANORK',
      module: 'ZeroDivu',
    });
  });

  child.on('exit', (code, signal) => {
    const why = signal ? `signal ${signal}` : `code ${code}`;
    const bootAge = workerBootAt ? Date.now() - workerBootAt : 999999;
    console.warn(`[${ts()}] [WA] Zero Divu encerrou (${why}) — Hanork continua`);

    const wasChild = child;
    child = null;

    if (lastLockConflict) {
      const live = findLiveWorkerPid();
      if (live && live !== wasChild?.pid) {
        adoptExternalWorker(live);
        lastLockConflict = false;
        return;
      }
    }

    const liveAfter = findLiveWorkerPid();
    if (liveAfter && liveAfter !== wasChild?.pid) {
      adoptExternalWorker(liveAfter);
      return;
    }

    if (code === 0 && signal === 'SIGTERM' && bootAge < 90000 && !stopping) {
      console.warn(
        '[ZeroDivu] Worker encerrou no boot (SIGTERM) — aguardando 8s antes de novo spawn (evita matar instância duplicada)'
      );
      if (restartTimer) clearTimeout(restartTimer);
      restartTimer = setTimeout(() => {
        restartTimer = null;
        maybeStart();
      }, 8000);
      if (restartTimer.unref) restartTimer.unref();
      return;
    }

    if (code === 0) restartAttempts = 0;

    if (!stopping && isZeroDivuEnabled() && code !== 0) {
      scheduleRestart(why);
    } else if (code === 0 && !stopping && bootAge < 15000) {
      // Saída limpa logo após subir — evita loop agressivo (ex.: lock/ENOMEM transitório)
      scheduleRestart(why);
    }
  });
}

function maybeStart() {
  if (!isZeroDivuEnabled()) return null;
  if (child && !child.killed) return child;
  if (adoptedPid && isPidAlive(adoptedPid)) return { adopted: true, pid: adoptedPid };
  if (starting) return child;

  const zeroRoot = ZERO_DIVU_CONFIG.zeroRoot;
  const connectJs = path.join(zeroRoot, 'connect.js');

  if (!fs.existsSync(connectJs)) {
    console.warn(`[ZeroDivu] connect.js não encontrado (${connectJs}) — só Telegram`);
    return null;
  }

  const live = findLiveWorkerPid();
  if (live && (!child || child.killed)) {
    return adoptExternalWorker(live);
  }

  starting = true;
  try {
    if (!preflightCleanup()) return null;
    if (!preflightNativeModules(zeroRoot)) {
      scheduleRestart('native modules invalid');
      return null;
    }

    spawnWorker();
    return child;
  } finally {
    starting = false;
  }
}

function stopZeroWorker() {
  stopping = true;
  adoptedPid = null;
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  clearMarker();
  if (!child || child.killed) return;
  try {
    child.kill('SIGTERM');
  } catch {
    /* ignore */
  }
}

process.on('exit', stopZeroWorker);

const adminWorkers = new Map();
const adminSpawning = new Set();
let watchdogTimer = null;
let watchdogStarted = false;

const {
  resolveSession,
  listSpawnableSessions,
  isDualWaEnabled,
  DEFAULT_PRIMARY,
  DEFAULT_SECONDARY,
} = require('./waSessionsManifest');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function adminCredsPath(conf) {
  const zeroRoot = ZERO_DIVU_CONFIG.zeroRoot;
  if (conf.sessionDir) return path.join(conf.sessionDir, 'session', 'creds.json');
  return path.join(zeroRoot, 'database', 'session', 'creds.json');
}

function adminHasStoredCreds(conf) {
  try {
    const p = adminCredsPath(conf);
    return fs.existsSync(p) && fs.statSync(p).size > 50;
  } catch {
    return false;
  }
}

function findAdminWorkerPid(conf) {
  if (process.platform === 'linux') {
    try {
      for (const name of fs.readdirSync('/proc')) {
        if (!/^\d+$/.test(name)) continue;
        const pid = Number(name);
        if (!pid || pid === process.pid) continue;
        try {
          const env = fs.readFileSync(`/proc/${pid}/environ`).toString('utf8');
          if (env.includes('WA_DIVULGACAO_USER=1')) continue;
          if (!env.includes(conf.ipcDir)) continue;
          if (conf.sessionId !== DEFAULT_PRIMARY && !env.includes(`WA_SESSION_ID=${conf.sessionId}`)) {
            continue;
          }
          return pid;
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
  }
  if (conf.sessionId === DEFAULT_PRIMARY) {
    if (child?.pid && isPidAlive(child.pid)) return child.pid;
    if (adoptedPid && isPidAlive(adoptedPid)) return adoptedPid;
  }
  const tracked = adminWorkers.get(conf.sessionId);
  if (tracked?.proc?.pid && isPidAlive(tracked.proc.pid)) return tracked.proc.pid;
  return null;
}

function applyDualWaPeerEnv(env, conf) {
  if (!isDualWaEnabled()) return env;
  try {
    const primary = resolveSession(DEFAULT_PRIMARY);
    const secondary = resolveSession(DEFAULT_SECONDARY);
    const peer = conf.sessionId === DEFAULT_PRIMARY ? secondary : primary;
    env.WA_DUAL_JOIN_BIDIRECTIONAL = '1';
    env.WA_DUAL_IPC_DIR_PEER = peer.ipcDir;
    env.WA_DUAL_PEER_SESSION = peer.sessionId;
    env.WA_DUAL_PRIMARY_SESSION = DEFAULT_PRIMARY;
    env.WA_DUAL_PEER_DISPLAY = peer.displayName || peer.sessionId;
  } catch {
    /* manifest incompleto */
  }
  return env;
}

function buildAdminSessionEnv(conf) {
  const zeroRoot = ZERO_DIVU_CONFIG.zeroRoot;
  const sharedDb = ZERO_DIVU_CONFIG.useSharedHanorkDb && conf.sessionId === DEFAULT_PRIMARY;
  const workerDbPath = conf.dbPath || ZERO_DIVU_CONFIG.zeroDivuDbPath;
  const token = getIpcToken();
  const env = sanitizeNodeOptions({
    ...process.env,
    HANORK_LOG_BG: process.env.HANORK_LOG_BG || '',
    HANORK_ZERO_WORKER: '1',
    HANORK_PARENT_PID: String(process.pid),
    ZERO_DIVU_NO_RESTART: '1',
    ZERO_DIVU_IPC_DIR: conf.ipcDir,
    ZERO_DIVU_MULTI_SESSION: '1',
    WA_SESSION_ID: conf.sessionId,
    WA_DISPLAY_NAME: conf.displayName || conf.label || conf.sessionId,
    ZERO_DIVU_STORAGE: 'sql',
    ZERO_DIVU_DB_PATH: workerDbPath,
    ZERO_DIVU_USE_HANORK_DB: sharedDb ? '1' : '0',
    ZERO_MAX_GROUPS: String(process.env.ZERO_MAX_GROUPS || '25'),
    BOT_USERNAME: process.env.BOT_USERNAME || process.env.HANORK_BOT_USERNAME || 'hanork_bot',
    HANORK_BOT_USERNAME: process.env.HANORK_BOT_USERNAME || process.env.BOT_USERNAME || 'hanork_bot',
    ...(token ? { ZERO_IPC_TOKEN: token } : {}),
  });
  if (conf.sessionDir) {
    env.ZERO_DIVU_SESSION_DIR = path.join(conf.sessionDir, 'session');
  }
  if (sharedDb) env.HANORK_DB_PATH = ZERO_DIVU_CONFIG.hanorkDbPath;
  applyDualWaPeerEnv(env, conf);
  return env;
}

function writeSessionMarker(conf, workerPid) {
  try {
    fs.mkdirSync(conf.ipcDir, { recursive: true });
    fs.writeFileSync(
      path.join(conf.ipcDir, MARKER_NAME),
      JSON.stringify({
        hanorkPid: process.pid,
        workerPid: workerPid || null,
        sessionId: conf.sessionId,
        startedAt: new Date().toISOString(),
      }),
      'utf8'
    );
  } catch {
    /* ignore */
  }
}

function spawnAdminSessionWorker(conf) {
  const zeroRoot = ZERO_DIVU_CONFIG.zeroRoot;
  const connectJs = path.join(zeroRoot, 'connect.js');
  if (!fs.existsSync(connectJs)) return null;

  const proc = spawn(process.execPath, [connectJs], {
    cwd: zeroRoot,
    env: buildAdminSessionEnv(conf),
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  pipeWa(proc.stdout, process.stdout);
  pipeWa(proc.stderr, process.stderr);

  adminWorkers.set(conf.sessionId, { proc, startedAt: Date.now() });
  proc.once('spawn', () => writeSessionMarker(conf, proc.pid));
  proc.on('exit', () => {
    const cur = adminWorkers.get(conf.sessionId);
    if (cur?.proc === proc) adminWorkers.delete(conf.sessionId);
  });
  return proc;
}

function ensureSessionWorker(sessionId = DEFAULT_PRIMARY) {
  if (!isZeroDivuEnabled()) return null;
  const conf = resolveSession(sessionId);
  const livePid = findAdminWorkerPid(conf);
  if (livePid && isPidAlive(livePid)) return { pid: livePid, alive: true };

  if (sessionId === DEFAULT_PRIMARY) {
    return maybeStart();
  }

  if (adminSpawning.has(sessionId)) {
    return adminWorkers.get(sessionId)?.proc || null;
  }

  adminSpawning.add(sessionId);
  try {
    return spawnAdminSessionWorker(conf);
  } finally {
    adminSpawning.delete(sessionId);
  }
}

function readSessionHealth(sessionId = DEFAULT_PRIMARY) {
  const conf = resolveSession(sessionId);
  const { getZeroDivuClient } = require('./ZeroDivuClient');
  const client = getZeroDivuClient(sessionId);
  const state = client.readState() || {};
  const workerPid = findAdminWorkerPid(conf);
  const workerAlive = Boolean(workerPid && isPidAlive(workerPid));
  const ipcFresh = client.isWorkerLikelyOnline();
  const hasCreds = adminHasStoredCreds(conf);
  const connected = Boolean(state.connected);
  const reconnecting =
    Boolean(state.reconnecting) || (hasCreds && workerAlive && !connected && ipcFresh);

  return {
    sessionId,
    state,
    workerPid,
    workerAlive,
    ipcFresh,
    hasCreds,
    connected,
    reconnecting,
  };
}

async function tryReconnectSession(sessionId, adminId = null) {
  const { getZeroDivuClient } = require('./ZeroDivuClient');
  const client = getZeroDivuClient(sessionId);
  return client.sendCommand('wa.reconnect_session', {}, adminId, { timeoutMs: 15000 });
}

async function ensureBothAdminWorkers(adminId = null, timeoutMs = 45000) {
  if (!isZeroDivuEnabled()) return { ok: false, reason: 'zero_divu_off' };

  maybeStart();
  for (const sid of listSpawnableSessions()) {
    ensureSessionWorker(sid);
  }

  const deadline = Date.now() + Math.max(3000, Number(timeoutMs) || 45000);
  while (Date.now() < deadline) {
    const ready = listSpawnableSessions().every((sid) => {
      const h = readSessionHealth(sid);
      return h.workerAlive && (h.ipcFresh || !h.hasCreds);
    });
    if (ready) return { ok: true };
    await sleep(500);
  }

  for (const sid of listSpawnableSessions()) {
    const h = readSessionHealth(sid);
    if (h.hasCreds && h.workerAlive && !h.connected) {
      await tryReconnectSession(sid, adminId).catch(() => null);
    }
  }

  const ok = listSpawnableSessions().every((sid) => readSessionHealth(sid).workerAlive);
  return { ok };
}

function startConnectionWatchdog() {
  if (watchdogStarted || !isZeroDivuEnabled()) return;
  watchdogStarted = true;
  const intervalMs = Math.max(15000, Number(process.env.WA_ADMIN_WATCHDOG_MS) || 45000);

  const tick = () => {
    if (stopping || !isZeroDivuEnabled()) return;
    ensureBothAdminWorkers(null, 12000).catch((e) => {
      waZeroLog.warn(`watchdog: ${e?.message || e}`);
    });
  };

  setTimeout(tick, 5000);
  watchdogTimer = setInterval(tick, intervalMs);
  if (watchdogTimer.unref) watchdogTimer.unref();
}

module.exports = {
  maybeStart,
  stopZeroWorker,
  startConnectionWatchdog,
  readSessionHealth,
  ensureSessionWorker,
  ensureBothAdminWorkers,
  tryReconnectSession,
};
