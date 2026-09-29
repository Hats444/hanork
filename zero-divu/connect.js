'use strict';

/**
 * Conexão WhatsApp — lógica estável do zero-divuh:
 * ao cair, encerra serviços, salva estado e reconecta do zero (sem pause/resume parcial).
 */

require('./src/config/env');
require('./scripts/patch-baileys-newsletter');

try {
  require('./src/services/campaignCleanup').applyProductsOnlyBoot();
} catch (e) {
  console.warn('[ZeroDivu] campaign cleanup:', e.message);
}

const fs = require('fs-extra');
const readline = require('readline');
const path = require('path');
const pathResolver = require('./src/utils/pathResolver');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
  delay,
} = require('@kurtucoben/baileys');
const { Boom } = require('@hapi/boom');
const P = require('pino');
const NodeCache = require('node-cache');
const cfg = require('./src/config/divulgacao');
const { showLoginQr } = require('./src/utils/qrPrint');
const { infoLog, successLog, errorLog, warningLog } = require('./src/utils/logger');
require('./src/utils/processGuards').install();
const gracefulShutdown = require('./src/services/gracefulShutdownManager');
gracefulShutdown.install();
gracefulShutdown.onTransientWsError(() => {
  connecting = false;
  setTimeout(() => {
    connect().catch(() => {});
  }, 3000);
});

const msgRetryCounterCache = new NodeCache();
const pairingCode = process.argv.includes('--code');
const rl = pairingCode
  ? readline.createInterface({ input: process.stdin, output: process.stdout })
  : null;
const question = (text) =>
  new Promise((r, rej) => {
    if (!rl) return rej(new Error('readline indisponível'));
    rl.question(text, r);
  });

let botStarted = false;
let lastQrPrinted = '';
let connecting = false;
let currentGen = 0;
let bootEvictedDupes = 0;
let connectedPhone = null;
let activeSock = null;
let forceQrEmit = false;
let waConnected = false;
let ipcPairPhone = null;
let qrLoginArmed = false;
let pairingReconnects = 0;
let pairCodeIssued = false;
let lastPairCodeEmitAt = 0;
let lastPairCodeFormatted = null;
let pairingForceRefresh = false;
let pairingReconnectDebounceUntil = 0;
const PAIRING_MAX_RECONNECTS = 3;
const PAIRING_CODE_COOLDOWN_MS = 45000;
const PAIRING_RECONNECT_DEBOUNCE_MS = 15000;
/** Pareamento parcial no disco sem registro final — expira após este intervalo */
const PARTIAL_PAIRING_STALE_MS = 15 * 60 * 1000;
/** Kelly-Bot / borutovk7: espera WS estabilizar antes de requestPairingCode */
const PAIRING_WS_DELAY_MS = Number(process.env.WA_PAIRING_WS_DELAY_MS) || 5000;
let pairingWsHandled = false;
let pairingAttempted = false;
let bootAutoConnect = false;
let consecutive408 = 0;
let consecutive428 = 0;
let rateLimitLastLogAt = 0;
let connectBackoffUntil = 0;

function recordRiskSignal(kind, msg) {
  try {
    require('./src/services/riskController').recordSignal(kind, msg);
  } catch {
    /* ignore */
  }
}

function isPairingOrLoginActive() {
  try {
    const phase = require('./src/services/gracefulShutdownManager').getLoginPhase?.();
    if (phase === 'pairing' || phase === 'qr') return true;
  } catch {
    /* ignore */
  }
  return Boolean(ipcPairPhone) || qrLoginArmed;
}

function isHanorkWorker() {
  return process.env.HANORK_ZERO_WORKER === '1';
}

function hasStoredSession() {
  try {
    const credsPath = path.join(pathResolver.getSessionDir(), 'creds.json');
    if (!fs.existsSync(credsPath)) return false;
    const creds = fs.readJsonSync(credsPath);
    return Boolean(creds?.registered);
  } catch {
    return false;
  }
}

function readCredsFromDisk() {
  try {
    const credsPath = path.join(pathResolver.getSessionDir(), 'creds.json');
    if (!fs.existsSync(credsPath)) return null;
    return fs.readJsonSync(credsPath);
  } catch {
    return null;
  }
}

/** Celular aceitou o código mas WS ainda não finalizou (registered=false). */
function hasPartialPairingOnDisk() {
  const creds = readCredsFromDisk();
  return Boolean(creds?.me?.id && !creds?.registered);
}

function mePhoneFromCreds(creds) {
  const id = creds?.me?.id;
  if (!id) return null;
  return String(id).split('@')[0].replace(/\D/g, '') || null;
}

/** creds parciais de pareamento abortado — invalidam novo código se não limpar */
function hasStalePairingCredsOnDisk() {
  try {
    const creds = readCredsFromDisk();
    if (!creds) return false;
    if (creds.registered) return false;
    return Boolean(creds.noiseKey || creds.pairingEphemeralKeyPair || creds.me?.id || creds.pairingCode);
  } catch {
    return false;
  }
}

function credsFileMtimeMs() {
  try {
    const credsPath = path.join(pathResolver.getSessionDir(), 'creds.json');
    if (!fs.existsSync(credsPath)) return 0;
    return fs.statSync(credsPath).mtimeMs;
  } catch {
    return 0;
  }
}

/** me.id salvo mas registered=false há muito tempo — código expirou, precisa wipe */
function isStalePartialPairing(maxAgeMs = PARTIAL_PAIRING_STALE_MS) {
  if (!hasPartialPairingOnDisk()) return false;
  if (lastPairCodeEmitAt > 0 && Date.now() - lastPairCodeEmitAt < PAIRING_CODE_COOLDOWN_MS) {
    return false;
  }
  const mtime = credsFileMtimeMs();
  if (!mtime) return true;
  return Date.now() - mtime > maxAgeMs;
}

/** Código emitido nesta sessão do worker — bloqueia re-emissão enquanto usuário digita no celular */
function hasLivePairCodeInSession() {
  return pairCodeIssued && lastPairCodeEmitAt > 0 && Date.now() - lastPairCodeEmitAt < PAIRING_CODE_COOLDOWN_MS;
}

const VERSION_CACHE_PATH = path.join(process.cwd(), 'database', 'runtime', 'wa-version.json');

function loadCachedWaVersion() {
  try {
    if (!fs.existsSync(VERSION_CACHE_PATH)) return null;
    const j = fs.readJsonSync(VERSION_CACHE_PATH);
    if (!Array.isArray(j?.version) || j.version.length < 3) return null;
    return j.version;
  } catch {
    return null;
  }
}

function saveCachedWaVersion(version) {
  try {
    fs.ensureDirSync(path.dirname(VERSION_CACHE_PATH));
    fs.writeJsonSync(VERSION_CACHE_PATH, { version, at: new Date().toISOString() }, { spaces: 2 });
  } catch {
    /* ignore */
  }
}

async function fetchWaVersionWithTimeout(timeoutMs = 20000) {
  const cached = loadCachedWaVersion();
  try {
    const res = await Promise.race([
      fetchLatestBaileysVersion(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('wa_version_timeout')), timeoutMs)),
    ]);
    if (res?.version?.length) {
      saveCachedWaVersion(res.version);
      return res.version;
    }
  } catch {
    /* ignore */
  }
  if (cached) return cached;
  // fallback conservador (só usado se rede estiver ruim e nunca teve cache)
  return [2, 3000, 1026924051];
}

function formatPairCode(code) {
  const s = String(code || '').replace(/\D/g, '');
  if (s.length === 8) return `${s.slice(0, 4)}-${s.slice(4)}`;
  return String(code || '');
}

const PAIRING_TRANSIENT_RE =
  /connection closed|connection terminated|terminated by server|timed out|websocket|preconnect|econnreset|etimedout|socket hang up/i;

function isPairingTransientError(err) {
  return PAIRING_TRANSIENT_RE.test(String(err?.message || err || ''));
}

/** Estilo Kelly-Bot (borutovk7): requestPairingCode após connecting/qr + delay WS. */
const PAIRING_PRECONNECT_RE =
  /not connected|preconnect|socket|connection closed|connection terminated|websocket|econnreset|etimedout/i;

function pairingBrowser() {
  try {
    if (typeof Browsers?.ubuntu === 'function') return Browsers.ubuntu('Chrome');
  } catch {
    /* ignore */
  }
  return Browsers('Chrome');
}

async function runPairingCode(sock, phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) throw new Error('Número não informado');

  const now = Date.now();
  if (
    !pairingForceRefresh &&
    lastPairCodeFormatted &&
    now - lastPairCodeEmitAt < PAIRING_CODE_COOLDOWN_MS
  ) {
    warningLog(`Pareamento: cooldown — mantendo código ${lastPairCodeFormatted}`);
    return {
      digits,
      code: String(lastPairCodeFormatted || '').replace(/\D/g, ''),
      formatted: lastPairCodeFormatted,
    };
  }

  let code;
  try {
    code = await sock.requestPairingCode(digits);
  } catch (e) {
    const msg = String(e?.message || e || '');
    if (!PAIRING_PRECONNECT_RE.test(msg) && !isPairingTransientError(e)) throw e;
    await delay(1200);
    code = await sock.requestPairingCode(digits);
  }
  const formatted = formatPairCode(code);
  lastPairCodeEmitAt = Date.now();
  lastPairCodeFormatted = formatted;
  pairingForceRefresh = false;
  successLog(`Código de pareamento: ${formatted}`);
  infoLog('WhatsApp → Aparelhos conectados → Conectar com número de telefone');
  try {
    require('./src/ipc/eventBus').emitPairingCode({
      phone: digits,
      code: String(code || '').replace(/\D/g, ''),
      formatted,
    });
  } catch {
    /* IPC opcional */
  }
  return { digits, code: String(code || '').replace(/\D/g, ''), formatted };
}

function schedulePairingReconnect(logMsg) {
  const now = Date.now();
  if (connecting || now < pairingReconnectDebounceUntil) return;
  if (pairingReconnects >= PAIRING_MAX_RECONNECTS) {
    warningLog('Pareamento: limite de reconexões — aguarde e use Novo código no Telegram');
    return;
  }
  pairingReconnects++;
  pairingReconnectDebounceUntil = now + PAIRING_RECONNECT_DEBOUNCE_MS;
  warningLog(logMsg);
  pairingAttempted = false;
  pairingWsHandled = false;
  const partial = hasPartialPairingOnDisk();
  const stalePartial = partial && isStalePartialPairing();
  if (stalePartial || (!partial && now - lastPairCodeEmitAt >= PAIRING_CODE_COOLDOWN_MS)) {
    pairCodeIssued = false;
  } else if (partial) {
    pairCodeIssued = true;
  }
  activeSock = null;
  connecting = false;
  gracefulShutdown.setLoginPhase('pairing');
  setTimeout(() => {
    if (ipcPairPhone && !waConnected) {
      connect().catch((e) => {
        errorLog(`Reconexão pareamento: ${e?.message || e}`);
      });
    }
  }, PAIRING_RECONNECT_DEBOUNCE_MS);
}

async function runPairingCodeWithRetry(sock, phone, maxAttempts = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await runPairingCode(sock, phone);
    } catch (e) {
      lastErr = e;
      if (!isPairingTransientError(e) || attempt >= maxAttempts) throw e;
      warningLog(
        `Pareamento tentativa ${attempt}/${maxAttempts} falhou (${e.message}) — retentando em ${attempt * 3}s…`
      );
      await delay(attempt * 3000);
    }
  }
  throw lastErr;
}

function clearSession(opts = {}) {
  const reason = opts.reason ? String(opts.reason) : '';
  try {
    require('./src/services/sessionBackup').purge();
  } catch {
    /* ignore */
  }
  const sessionDir = pathResolver.getSessionDir();
  try {
    fs.removeSync(sessionDir);
  } catch {
    /* ignore */
  }
  fs.ensureDirSync(sessionDir);
  // Remove qualquer backup residual dentro do diretório (evita "restaurar" sessão banida).
  try {
    for (const name of fs.readdirSync(sessionDir)) {
      if (/\.bak(\.\d+)?$/i.test(name) || name.endsWith('.bak')) {
        try {
          fs.removeSync(path.join(sessionDir, name));
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }
  warningLog(`Sessão apagada${reason ? ` (${reason})` : ''} — use /wa_conectar no Telegram para novo login`);
}

function checkQrDeps() {
  try {
    require.resolve('qrcode');
    require.resolve('qrcode-terminal');
    return true;
  } catch {
    errorLog('Pacotes qrcode / qrcode-terminal não instalados!');
    errorLog('Rode: npm install');
    return false;
  }
}

function reconnectDelayMs(statusCode) {
  if (statusCode === 408) {
    const base = cfg.RECONNECT_408_MS ?? 12000;
    const max = cfg.RECONNECT_408_MAX_MS ?? 120000;
    const steps = cfg.RECONNECT_408_BACKOFF_STEPS ?? 6;
    const n = Math.min(consecutive408, steps);
    return Math.min(max, Math.round(base * Math.pow(1.45, n)));
  }
  if (statusCode === 440) return cfg.RECONNECT_440_MIN_MS ?? 15000;
  if (statusCode === 515) return cfg.RECONNECT_515_MS ?? 15000;
  if (statusCode === 428) {
    const base = cfg.RECONNECT_RATE_LIMIT_MS ?? 120000;
    const max = cfg.RECONNECT_RATE_LIMIT_MAX_MS ?? 30 * 60 * 1000;
    const steps = cfg.RECONNECT_RATE_LIMIT_BACKOFF_STEPS ?? 8;
    const n = Math.min(consecutive428, steps);
    return Math.min(max, Math.round(base * Math.pow(1.55, n)));
  }
  return cfg.RECONNECT_SIMPLE_MS ?? 5000;
}

function logDisconnect(statusCode, lastDisconnect) {
  const errMsg = String(lastDisconnect?.error?.message || lastDisconnect?.error || '').toLowerCase();
  const loginActive = isPairingOrLoginActive();

  if (!loginActive) {
    if (/\b403\b/.test(String(statusCode || '')) || /spam|spammed|blocked|ban|temporarily blocked|temporariamente bloquead/.test(errMsg)) {
      recordRiskSignal('wa_spam_block', `disconnect:${statusCode || 'unknown'}:${errMsg}`);
    } else if (statusCode === 428 || /rate|overlimit|too many|429/.test(errMsg)) {
      recordRiskSignal('wa_rate_limit', `disconnect:${statusCode || 'unknown'}:${errMsg}`);
    } else if (statusCode === 408 || /connection closed|connection was lost|stream errored|offline/.test(errMsg)) {
      recordRiskSignal('wa_unstable', `disconnect:${statusCode || 'unknown'}:${errMsg}`);
    }
  }

  if (statusCode === 408 || statusCode === 428) {
    try {
      const groupCache = require('./src/services/groupCache');
      if (statusCode === 408) groupCache.markWeakConnection();
      else groupCache.markRateLimited();
    } catch {
      /* ignore */
    }
  }
  if (statusCode === 515) {
    warningLog('Reiniciando conexão (515)...');
    return;
  }
  if (statusCode === 408) {
    consecutive408 = Math.min((consecutive408 || 0) + 1, 12);
    const waitSec = Math.round(reconnectDelayMs(408) / 1000);
    warningLog(
      `Conexão fraca (408 #${consecutive408}) — reconectando em ~${waitSec}s (sem sync pesado)`
    );
    return;
  }
  if (statusCode === 440) {
    warningLog(
      'Outra sessão WhatsApp Web aberta (440) — feche no celular: Aparelhos conectados'
    );
    return;
  }
  if (statusCode === 428) {
    const now = Date.now();
    if (now - rateLimitLastLogAt > 120000) {
      rateLimitLastLogAt = now;
      const waitSec = Math.round(reconnectDelayMs(428) / 1000);
      const label = waitSec >= 60 ? `~${Math.round(waitSec / 60)} min` : `~${waitSec}s`;
      warningLog(`Rate limit WhatsApp (#${consecutive428}) — próxima tentativa em ${label}`);
    }
    return;
  }
  if (statusCode) {
    warningLog(`Conexão fechada (código ${statusCode})`);
  } else {
    warningLog(`Conexão fechada: ${lastDisconnect?.error?.message || 'desconhecido'}`);
  }
}

/** Igual zero-divuh: para tudo e salva antes de abrir socket de novo */
async function teardownBeforeReconnect() {
  if (!activeSock && !botStarted) return;
  botStarted = false;

  try {
    require('./src/utils/cycleLock').forceReset('reconnect');
  } catch {
    /* ignore */
  }

  try {
    require('./src/bot').stop();
  } catch {
    /* ignore */
  }

  try {
    require('./src/services/persistence').shutdown();
    require('./src/services/blacklist').flush();
    require('./src/utils/debouncedStore').flushAll();
  } catch {
    /* ignore */
  }

  try {
    require('./src/services/socketRegistry').setPaused(true);
    await require('./src/services/socketRegistry').close();
  } catch {
    /* ignore */
  }
}

async function closeStaleSocket(sock) {
  if (!sock) return;
  try {
    sock.end?.();
  } catch {
    /* ignore */
  }
}

async function connect() {
  if (connecting) return;
  if (require('./src/services/gracefulShutdownManager').isShuttingDown()) return;

  const nowGate = Date.now();
  if (connectBackoffUntil && nowGate < connectBackoffUntil) {
    const wait = Math.max(5000, connectBackoffUntil - nowGate);
    if (nowGate - rateLimitLastLogAt > 60000) {
      rateLimitLastLogAt = nowGate;
      warningLog(`WA em cooldown rate-limit — retomando em ~${Math.round(wait / 60000)} min`);
    }
    setTimeout(() => {
      connect().catch(() => {});
    }, Math.min(wait, 60000));
    return;
  }

  connecting = true;
  const gen = ++currentGen;

  try {
    if (!pairingCode && !checkQrDeps()) {
      process.exit(1);
    }

    const pairingWaitReconnect = Boolean(ipcPairPhone && pairCodeIssued && !waConnected);
    if (!pairingWaitReconnect) {
      await teardownBeforeReconnect();
    } else if (activeSock) {
      try {
        activeSock.end?.();
      } catch {
        /* ignore */
      }
      activeSock = null;
    }

    try {
      const pairingFastBoot = Boolean(ipcPairPhone);
      await delay(pairingFastBoot ? 200 : (cfg.SINGLE_INSTANCE_SETTLE_MS ?? 1500));
    } catch {
      /* ignore */
    }

    if (bootEvictedDupes > 0) {
      infoLog('Instâncias duplicadas encerradas — boot direto (sem espera pós-stop)');
      bootEvictedDupes = 0;
    }

    fs.ensureDirSync(pathResolver.getSessionDir());

    try {
      require('./src/services/sessionBackup').restoreIfNeeded();
    } catch {
      /* ignore */
    }

    const sessionDir = pathResolver.getSessionDir();
    infoLog('Carregando sessão...');
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

    const saveCredsSafe = async () => {
      await saveCreds();
      try {
        require('./src/services/sessionBackup').backup();
      } catch {
        /* ignore */
      }
    };

    if (state.creds?.me?.id) {
      infoLog(`Sessão encontrada: ${state.creds.me.id.split(':')[0]}`);
    } else if (pairingCode) {
      infoLog('Modo pareamento — informe o número quando solicitado');
    } else if (!isHanorkWorker() || qrLoginArmed) {
      infoLog('Primeiro login — escaneie o QR Code (só precisa fazer isso uma vez)');
    }

    const pairingFastBoot = Boolean(ipcPairPhone);
    if (pairingFastBoot) {
      const cachedVer = loadCachedWaVersion();
      if (cachedVer) {
        infoLog(`Versão WA Web (cache): ${cachedVer.join('.')}`);
      } else {
        infoLog('Buscando versão do WhatsApp Web (pareamento rápido)…');
      }
    } else {
      infoLog('Buscando versão do WhatsApp Web...');
    }
    const version =
      (pairingFastBoot && loadCachedWaVersion()) ||
      (await fetchWaVersionWithTimeout(pairingFastBoot ? 3000 : (cfg.WA_VERSION_TIMEOUT_MS ?? 20000)));
    infoLog(`Versão WA Web: ${version.join('.')}`);

    const sock = makeWASocket({
      version,
      auth: state,
      syncFullHistory: false,
      printQRInTerminal: false,
      qrTimeout: 180000,
      logger: P({ level: 'silent' }),
      browser: pairingBrowser(),
      msgRetryCounterCache,
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: cfg.WA_QUERY_TIMEOUT_MS ?? 120000,
      keepAliveIntervalMs: cfg.CONNECTION_KEEP_ALIVE_MS ?? 10000,
      emitOwnEvents: true,
      fireInitQueries: false,
      markOnlineOnConnect: false,
      retryRequestDelayMs: 5000,
      maxMsgRetryCount: 3,
    });

    if (gen !== currentGen) {
      await closeStaleSocket(sock);
      return;
    }

    const pairPhone = ipcPairPhone;
    const usePairing = pairingCode || Boolean(pairPhone);
    let pairingPhoneResolved = pairPhone ? String(pairPhone).replace(/\D/g, '') : null;
    pairingAttempted = false;

    async function attemptPairingOnce() {
      if (pairingAttempted || pairCodeIssued || gen !== currentGen) return;
      if (qrLoginArmed || !usePairing || sock.authState.creds.registered) return;
      pairingAttempted = true;
      gracefulShutdown.setLoginPhase('pairing');

      const pairingWatchdog = setTimeout(() => {
        if (gen !== currentGen || !ipcPairPhone) return;
        try {
          require('./src/ipc/eventBus').appendEvent({
            type: 'wa.pairing_failed',
            message: 'Timed Out — WhatsApp não respondeu em 90s',
          });
        } catch {
          /* ignore */
        }
      }, 90000);
      if (pairingWatchdog.unref) pairingWatchdog.unref();

      try {
        let phone = pairingPhoneResolved;
        if (!phone && pairingCode) {
          phone = (await question('\nNúmero com DDI (ex: 5594999999999): ')).replace(/\D/g, '');
          pairingPhoneResolved = phone;
        }
        await runPairingCodeWithRetry(sock, phone);
        clearTimeout(pairingWatchdog);
        pairingReconnects = 0;
        pairCodeIssued = true;
        // Mantém ipcPairPhone até connection open — permite reconectar enquanto usuário digita o código.
        if (rl && !rl.closed) rl.close();
      } catch (e) {
        clearTimeout(pairingWatchdog);
        pairingWsHandled = false;
        if (
          isPairingTransientError(e) &&
          pairPhone &&
          isHanorkWorker() &&
          gen === currentGen &&
          pairingReconnects < PAIRING_MAX_RECONNECTS
        ) {
          pairingReconnects++;
          if (!pairCodeIssued) {
            pairingAttempted = false;
          }
          ipcPairPhone = pairingPhoneResolved || ipcPairPhone;
          warningLog(
            `Erro no pareamento (transitório ${pairingReconnects}/${PAIRING_MAX_RECONNECTS}): ${e.message} — reconectando…`
          );
          connecting = false;
          try {
            sock.end?.();
          } catch {
            /* ignore */
          }
          setTimeout(() => {
            if (gen === currentGen && ipcPairPhone) {
              connect().catch(() => {});
            }
          }, 4000);
          return;
        }
        pairingReconnects = 0;
        ipcPairPhone = null;
        pairCodeIssued = false;
        pairingAttempted = false;
        gracefulShutdown.setLoginPhase(null);
        errorLog(`Erro no pareamento: ${e.message}`);
        try {
          require('./src/ipc/eventBus').appendEvent({
            type: 'wa.pairing_failed',
            message: e?.message || String(e),
          });
        } catch {
          /* ignore */
        }
        if (!pairingCode && isHanorkWorker()) {
          connecting = false;
          try {
            sock.end?.();
          } catch {
            /* ignore */
          }
        }
        if (pairingCode && !rl?.closed) rl.close();
        if (pairingCode) process.exit(1);
      }
    }

    function scheduleKellyPairingCode() {
      if (
        !usePairing ||
        !pairingPhoneResolved ||
        sock.authState.creds.registered ||
        pairCodeIssued ||
        pairingWsHandled ||
        qrLoginArmed
      ) {
        return;
      }
      pairingWsHandled = true;
      infoLog(
        `Pareamento: aguardando ${Math.round(PAIRING_WS_DELAY_MS / 1000)}s (WS) antes do código…`
      );
      setTimeout(() => {
        if (gen !== currentGen || pairCodeIssued || sock.authState?.creds?.registered) return;
        attemptPairingOnce().catch(() => {
          pairingWsHandled = false;
          pairingAttempted = false;
        });
      }, PAIRING_WS_DELAY_MS);
    }

    async function finalizeWaConnection() {
      if (gen !== currentGen || waConnected) return;
      if (!sock.authState?.creds?.registered) return;

      gracefulShutdown.setLoginPhase(null);
      ipcPairPhone = null;
      pairCodeIssued = false;
      pairingReconnects = 0;
      pairingWsHandled = false;

      consecutive408 = 0;
      consecutive428 = 0;
      connectBackoffUntil = 0;
      connectedPhone = null;
      try {
        const me = sock.user || sock.authState?.creds?.me;
        connectedPhone = me?.id?.split(':')?.[0] || me?.id || null;
      } catch {
        /* ignore */
      }
      activeSock = sock;
      waConnected = true;
      qrLoginArmed = false;
      bootAutoConnect = false;
      successLog('WhatsApp conectado');
      try {
        require('./src/services/riskController').onWhatsAppConnected();
      } catch {
        /* ignore */
      }
      try {
        require('./src/ipc/eventBus').emitConnected({ phone: connectedPhone });
      } catch {
        /* IPC opcional */
      }

      const warmupMs = cfg.CONNECTION_WARMUP_MS ?? 0;
      require('./src/services/socketRegistry').register(sock, { warmupMs });

      if (warmupMs > 0) {
        infoLog(
          `Estabilizando conexão — sem consultas pesadas por ${Math.round(warmupMs / 1000)}s`
        );
        try {
          require('./src/services/queueManager').freeze();
        } catch {
          /* ignore */
        }
        setTimeout(() => {
          try {
            require('./src/services/socketRegistry').clearWarmup();
            require('./src/services/queueManager').unfreeze();
            infoLog('Conexão estável — filas e timers liberados');
          } catch {
            /* ignore */
          }
        }, warmupMs);
      } else {
        try {
          require('./src/services/socketRegistry').setPaused(false);
          require('./src/services/queueManager').unfreeze();
        } catch {
          /* ignore */
        }
      }

      if (!botStarted) {
        botStarted = true;
        try {
          require('./src/services/processRuntime').markFreshBoot();
          const ok = await require('./src/bot').start(sock, { reconnect: false });
          if (!ok) botStarted = false;
        } catch (e) {
          botStarted = false;
          errorLog(`Inicialização do bot: ${e.message}`);
        }
      }
    }

    sock.ev.process(async (events) => {
      if (gen !== currentGen) return;

      if (events['creds.update']) {
        await saveCredsSafe();
        const c = sock.authState?.creds;
        if (c?.registered && c?.me?.id && !waConnected) {
          await finalizeWaConnection();
        }
      }

      if (!events['connection.update']) return;

      const { connection, lastDisconnect, qr } = events['connection.update'];
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;

      if (qr && (qrLoginArmed || !usePairing) && (qr !== lastQrPrinted || forceQrEmit)) {
        const mayShowQr = qrLoginArmed || !isHanorkWorker();
        if (!mayShowQr) return;

        lastQrPrinted = qr;
        forceQrEmit = false;

        if (isHanorkWorker()) {
          try {
            const { qrToBuffer, QR_PNG } = require('./src/utils/qrPrint');
            const buf = await qrToBuffer(qr);
            if (buf) {
              await require('./src/ipc/eventBus').emitQr({
                pngBase64: buf.toString('base64'),
                filePath: QR_PNG,
              });
            }
          } catch {
            /* IPC opcional */
          }
        } else {
          await showLoginQr(qr, infoLog);
          try {
            const { qrToBuffer, QR_PNG } = require('./src/utils/qrPrint');
            const buf = await qrToBuffer(qr);
            if (buf) {
              await require('./src/ipc/eventBus').emitQr({
                pngBase64: buf.toString('base64'),
                filePath: QR_PNG,
              });
            }
          } catch {
            /* IPC opcional */
          }
        }
      }

      if (connection === 'connecting') {
        infoLog('Conectando ao WhatsApp...');
        scheduleKellyPairingCode();
      }

      if (usePairing && qr && !sock.authState.creds.registered && !qrLoginArmed) {
        scheduleKellyPairingCode();
      }

      if (connection === 'open') {
        if (require('./src/services/gracefulShutdownManager').isShuttingDown()) return;

        const registered = Boolean(sock.authState?.creds?.registered);
        if (!registered) {
          infoLog('Conexão aberta — aguardando creds registradas…');
          return;
        }

        await finalizeWaConnection();
        return;
      }

      if (connection === 'close') {
        if (gen !== currentGen) return;
        if (require('./src/services/gracefulShutdownManager').isShuttingDown()) return;

        const unregisteredPairing =
          !sock.authState?.creds?.registered && Boolean(ipcPairPhone || usePairing);
        if (
          unregisteredPairing &&
          (statusCode === 515 || statusCode === DisconnectReason.restartRequired)
        ) {
          schedulePairingReconnect('Pareamento: reinício WA (515) — reconectando…');
          return;
        }

        const wasConnected = waConnected || botStarted;
        waConnected = false;
        activeSock = null;

        const errMsg = String(lastDisconnect?.error?.message || lastDisconnect?.error || '').toLowerCase();
        const hardBlocked =
          /\b403\b/.test(String(statusCode || '')) ||
          /spam|spammed|blocked|ban|temporarily blocked|temporariamente bloquead/.test(errMsg);

        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        logDisconnect(statusCode, lastDisconnect);

        if (statusCode === 440 && cfg.SINGLE_INSTANCE_KILL_DUPES !== false) {
          try {
            const resolved = await require('./src/services/conflict440Resolver').autoResolve();
            if (resolved.evicted) {
              infoLog(`${resolved.evicted} instância(s) duplicada(s) encerrada(s)`);
            }
          } catch {
            /* ignore */
          }
        }

        if (hardBlocked || statusCode === DisconnectReason.loggedOut || statusCode === 401) {
          const partialPairing = hasPartialPairingOnDisk();
          if (
            !hardBlocked &&
            isHanorkWorker() &&
            !waConnected &&
            (ipcPairPhone || partialPairing)
          ) {
            schedulePairingReconnect(
              partialPairing
                ? 'Pareamento parcial no celular — retomando registro…'
                : `Socket caiu durante pareamento (${statusCode || 'loggedOut'}) — aguardando reconexão…`
            );
            return;
          }
          connectedPhone = null;
          activeSock = null;
          botStarted = false;
          qrLoginArmed = false;
          ipcPairPhone = null;
          pairCodeIssued = false;
          try {
            require('./src/ipc/eventBus').emitDisconnected({
              reason: hardBlocked ? `hard_block:${statusCode || 'unknown'}` : statusCode === DisconnectReason.loggedOut ? 'loggedOut' : '401',
            });
          } catch {
            /* IPC opcional */
          }
          clearSession({ reason: hardBlocked ? `hard_block:${statusCode || 'unknown'}` : 'invalid' });
          lastQrPrinted = '';
          await delay(3000);
          connecting = false;
          if (isHanorkWorker()) {
            // IMPORTANT: evita flood de logs / reconexões automáticas com conta banida.
            infoLog('Sessão limpa — aguardando /wa_conectar no Telegram para novo QR');
            return;
          }
          errorLog(
            hardBlocked
              ? 'Conta bloqueada/banida (403/spam) — limpando e gerando novo QR...'
              : 'Sessão inválida — limpando e gerando novo QR...'
          );
          return connect();
        }

        if (statusCode === 428) {
          consecutive428 = Math.min((consecutive428 || 0) + 1, 24);
          const pauseAfter = cfg.CONNECT_RATE_LIMIT_PAUSE_AFTER ?? 5;
          const cooldownMs = cfg.CONNECT_RATE_LIMIT_COOLDOWN_MS ?? 30 * 60 * 1000;
          if (consecutive428 >= pauseAfter) {
            connectBackoffUntil = Date.now() + cooldownMs;
            try {
              require('./src/services/riskController').recordConnectStorm(consecutive428, cooldownMs);
            } catch {
              recordRiskSignal('wa_connect_storm', `connect_storm:${consecutive428}`);
            }
            connecting = false;
            if (isHanorkWorker()) {
              warningLog(
                `Rate limit persistente (${consecutive428}x) — pausa ${Math.round(cooldownMs / 60000)} min. Use /wa_conectar depois.`
              );
              return;
            }
          }
        }

        if (shouldReconnect) {
          const pairingActive = isPairingOrLoginActive();
          const savedSession = hasStoredSession();
          const mayAutoReconnect = savedSession || wasConnected || bootAutoConnect;
          if (isHanorkWorker() && !qrLoginArmed && !pairingActive && !mayAutoReconnect) {
            connecting = false;
            infoLog('Conexão interrompida — use /wa_conectar no Telegram');
            return;
          }
          if (pairingActive) {
            if (!pairCodeIssued) {
              pairingAttempted = false;
            }
            gracefulShutdown.setLoginPhase('pairing');
          }
          if (pairCodeIssued && ipcPairPhone && isHanorkWorker()) {
            schedulePairingReconnect('Queda durante pareamento — reconexão em breve…');
            return;
          }
          const waitMs = reconnectDelayMs(statusCode);
          await teardownBeforeReconnect();
          await delay(waitMs);
          connecting = false;
          return connect();
        }

        errorLog('Não foi possível reconectar');
        process.exit(1);
      }
    });

    // Zero Two: pairing imediato pós-socket quando o número já veio via IPC.
    const partialCreds = state.creds;
    const partialPairing =
      Boolean(partialCreds?.me?.id && !partialCreds?.registered);
    if (partialPairing) {
      const mePhone = mePhoneFromCreds(partialCreds);
      if (mePhone && !ipcPairPhone) ipcPairPhone = mePhone;
      pairCodeIssued = false;
      pairingWsHandled = false;
      pairingAttempted = false;
      gracefulShutdown.setLoginPhase('pairing');
      if (isStalePartialPairing()) {
        infoLog('Pareamento parcial expirado — aguardando novo código via Telegram');
      } else {
        infoLog('Pareamento parcial no disco — aguardando Telegram ou registro WA…');
      }
    }
    // Kelly-style: código só via connection.update (connecting/qr + delay) — não imediato pós-socket.
  } catch (e) {
    connecting = false;
    throw e;
  } finally {
    connecting = false;
  }
}

async function bootstrap() {
  if (cfg.SINGLE_INSTANCE_LOCK !== false) {
    const claim = await require('./src/services/singleInstance').claimExclusive();
    bootEvictedDupes = claim?.evicted || 0;
    if (bootEvictedDupes > 0) {
      warningLog(
        `${bootEvictedDupes} instância(s) duplicada(s) encerrada(s) — causa comum do erro 440`
      );
      if (process.env.HANORK_ZERO_WORKER === '1') {
        warningLog('Hanork gerencia o Zero — use só: node src/bot.js');
      } else {
        warningLog('Use só UM comando: npm run bot OU npm start (não os dois)');
      }
    }
  }

  try {
    require('./src/ipc/runtimeBridge').register({
      getRuntime: () => ({
        connected: waConnected,
        phone: connectedPhone,
        botRunning: Boolean(botStarted),
      }),
      getSock: () => activeSock,
      clearLastQr: () => {
        lastQrPrinted = '';
        forceQrEmit = true;
      },
      armQrLogin: () => {
        ipcPairPhone = null;
        gracefulShutdown.setLoginPhase('qr');
        qrLoginArmed = true;
      },
      restartLogin: async () => {
        if (waConnected) {
          return { ok: false, error: 'already_connected' };
        }
        const wasPairing = Boolean(ipcPairPhone);
        ipcPairPhone = null;
        pairCodeIssued = false;
        pairingReconnects = 0;
        gracefulShutdown.setLoginPhase('qr');
        qrLoginArmed = true;
        lastQrPrinted = '';
        forceQrEmit = true;

        const needWipe =
          hasStoredSession() || Boolean(activeSock?.authState?.creds?.registered);

        if (needWipe) {
          if (activeSock) {
            try {
              await activeSock.logout();
            } catch {
              /* ignore */
            }
            activeSock = null;
          }
          try {
            clearSession({ reason: 'qr_login' });
          } catch {
            /* ignore */
          }
        }

        if (connecting || wasPairing) {
          currentGen++;
          try {
            await teardownBeforeReconnect();
          } catch {
            /* ignore */
          }
          connecting = false;
        }

        connect().catch((e) => {
          errorLog(`Reconexão login: ${e?.message || e}`);
        });
        return { ok: true };
      },
      requestReconnectSession: async () => {
        if (waConnected) {
          try {
            const snap = await require('./src/ipc/stateWriter').writeStateSnapshot({
              connected: true,
              phone: connectedPhone,
            });
            return { ok: true, alreadyConnected: true, ...snap };
          } catch {
            return { ok: true, alreadyConnected: true, connected: true, phone: connectedPhone };
          }
        }
        if (
          ipcPairPhone ||
          gracefulShutdown.getLoginPhase?.() === 'pairing' ||
          (qrLoginArmed && connecting)
        ) {
          return {
            ok: false,
            error: 'login_in_progress',
            message: 'Login em andamento — aguarde QR ou código',
          };
        }
        if (!hasStoredSession()) {
          return {
            ok: false,
            error: 'no_session',
            message: 'Nenhuma sessão salva — conecte com QR ou código',
          };
        }
        ipcPairPhone = null;
        qrLoginArmed = false;
        pairCodeIssued = false;
        pairingReconnects = 0;
        gracefulShutdown.setLoginPhase(null);
        if (connecting) {
          currentGen++;
          await teardownBeforeReconnect();
        }
        connecting = false;
        waConnected = false;
        connectedPhone = null;
        bootAutoConnect = true;
        connect().catch((e) => {
          errorLog(`Reconexão sessão salva: ${e?.message || e}`);
        });
        return { ok: true, reconnecting: true, message: 'Reconectando sessão salva…' };
      },
      requestLogout: async () => {
        try {
          require('./src/bot').stop?.();
        } catch {
          /* ignore */
        }
        botStarted = false;
        waConnected = false;
        connectedPhone = null;
        if (activeSock) {
          try {
            await activeSock.logout();
          } catch {
            /* ignore */
          }
          activeSock = null;
        }
        clearSession();
        lastQrPrinted = '';
        forceQrEmit = true;
        qrLoginArmed = false;
        connecting = false;
        try {
          require('./src/ipc/eventBus').emitDisconnected({ reason: 'admin_logout' });
        } catch {
          /* ignore */
        }
        if (isHanorkWorker()) {
          return { ok: true, message: 'Sessão limpa — use /wa_conectar no Telegram' };
        }
        await delay(2500);
        connect().catch((e) => {
          errorLog(`Reconexão pós-logout: ${e?.message || e}`);
        });
        return { ok: true, message: 'Sessão limpa — escaneie novo QR' };
      },
      requestPairing: async (phone, opts = {}) => {
        if (waConnected) {
          return { ok: false, error: 'already_connected', message: 'WhatsApp já conectado' };
        }
        const digits = String(phone || '').replace(/\D/g, '');
        let forceRefresh = Boolean(opts.forceRefresh || opts.forceSwap);
        if (isStalePartialPairing()) forceRefresh = true;
        if (forceRefresh) pairingForceRefresh = true;
        if (digits.length < 10 || digits.length > 15) {
          return {
            ok: false,
            error: 'invalid_phone',
            message: 'Número inválido — use DDI+DDD+número (ex: 5511999999999)',
          };
        }

        const prevPhone = ipcPairPhone ? String(ipcPairPhone).replace(/\D/g, '') : null;
        const samePhone = prevPhone === digits;

        // Zero Two: socket vivo → novo código na hora (Novo código / retry)
        if (
          samePhone &&
          activeSock &&
          !waConnected &&
          !activeSock.authState?.creds?.registered
        ) {
          pairingAttempted = false;
          pairCodeIssued = false;
          gracefulShutdown.setLoginPhase('pairing');
          try {
            const r = await runPairingCodeWithRetry(activeSock, digits);
            ipcPairPhone = digits;
            return {
              ok: true,
              waiting: true,
              phone: digits,
              code: r.code,
              formatted: r.formatted,
            };
          } catch (e) {
            warningLog(`Refresh pareamento: ${e?.message || e} — reconectando…`);
          }
        }

        if (samePhone && connecting && !forceRefresh && !pairCodeIssued) {
          return { ok: true, waiting: true, phone: digits, message: 'Pareamento em andamento' };
        }

        if (samePhone && pairCodeIssued && !forceRefresh) {
          if (hasLivePairCodeInSession()) {
            return {
              ok: true,
              waiting: true,
              phone: digits,
              message: 'Código já emitido — use Novo código se expirou',
            };
          }
          forceRefresh = true;
          pairingForceRefresh = true;
          pairCodeIssued = false;
          pairingWsHandled = false;
          pairingAttempted = false;
        }

        if (qrLoginArmed && connecting && !ipcPairPhone) {
          qrLoginArmed = false;
          lastQrPrinted = '';
          forceQrEmit = false;
          currentGen++;
          try {
            await teardownBeforeReconnect();
          } catch {
            /* ignore */
          }
          connecting = false;
        }
        if (connecting && ipcPairPhone && samePhone && !forceRefresh && hasLivePairCodeInSession()) {
          return {
            ok: true,
            waiting: true,
            phone: String(ipcPairPhone).replace(/\D/g, ''),
            message: 'Pareamento já em andamento',
          };
        }

        pairingReconnects = 0;
        pairCodeIssued = false;
        pairingWsHandled = false;
        ipcPairPhone = digits;
        qrLoginArmed = false;
        lastQrPrinted = '';
        forceQrEmit = false;
        botStarted = false;
        waConnected = false;
        connectedPhone = null;
        gracefulShutdown.setLoginPhase('pairing');

        const partialSamePhone =
          hasPartialPairingOnDisk() && mePhoneFromCreds(readCredsFromDisk()) === digits;
        const freshPartial =
          partialSamePhone &&
          hasLivePairCodeInSession() &&
          !isStalePartialPairing();

        const needWipe =
          forceRefresh ||
          (hasStalePairingCredsOnDisk() && !freshPartial) ||
          (hasStoredSession() && !pairCodeIssued && !freshPartial) ||
          (prevPhone && prevPhone !== digits) ||
          Boolean(activeSock?.authState?.creds?.registered);

        if (needWipe) {
          if (activeSock) {
            try {
              await activeSock.logout();
            } catch {
              /* ignore */
            }
            activeSock = null;
          }
          clearSession({ reason: 'pairing' });
        }

        connecting = false;
        currentGen++;
        connect().catch((e) => {
          errorLog(`Reconexão pareamento: ${e?.message || e}`);
        });
        return { ok: true, waiting: true, phone: digits };
      },
    });
    await require('./src/ipc/server').start();
    try {
      const rec = require('./src/services/blastCoordinator').recoverStaleBlastLocks();
      if (rec.recovered) {
        warningLog(`Blast lock órfão removido (${(rec.reasons || []).join(', ') || 'stale'})`);
      }
    } catch {
      /* ignore */
    }
  } catch (e) {
    warningLog(`IPC Hanork indisponível: ${e?.message || e}`);
  }

  if (isHanorkWorker()) {
    // Em produção: se já existe sessão salva, conectar e iniciar divulgação automaticamente.
    // Se não existir sessão, fica em idle até /wa_conectar (sem QR no console).
    const hasSession = hasStoredSession();
    const partialPairing = hasPartialPairingOnDisk();
    const stalePartial = partialPairing && isStalePartialPairing();
    if (stalePartial) {
      infoLog('Pareamento parcial expirado — limpando sessão antiga');
      clearSession({ reason: 'stale_partial' });
    }
    bootAutoConnect = hasSession || (partialPairing && !stalePartial);
    if (bootAutoConnect) {
      infoLog(
        partialPairing && !stalePartial
          ? 'Pareamento parcial detectado — retomando conexão…'
          : 'Sessão WhatsApp salva detectada — conectando automaticamente…'
      );
      connect().catch((e) => {
        errorLog(`Boot auto-connect: ${e?.message || e}`);
      });
    } else {
      infoLog('WhatsApp aguardando login — use /wa_conectar no Telegram (sem QR no console)');
      try {
        require('./src/services/processHeartbeat').start(30000, {
          keepAlive: true,
          extra: { hanorkIdle: true },
        });
      } catch {
        /* ignore */
      }
      try {
        require('./src/ipc/eventBus').emitDisconnected({ reason: 'awaiting_login' });
        await require('./src/ipc/stateWriter').writeStateSnapshot({
          connected: false,
          phone: null,
        });
      } catch {
        /* IPC opcional */
      }
    }
  } else {
    await connect();
  }
}

bootstrap().catch((e) => {
  errorLog(`Conexão: ${e?.message || e}`);
  process.exit(1);
});
