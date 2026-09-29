'use strict';

const cfg = require('../config/divulgacao');
const store = require('../utils/debouncedStore');
const runtimeSnapshot = require('./runtimeSnapshot');
const processHeartbeat = require('./processHeartbeat');
const persistentLocks = require('./persistentLocks');
const { infoLog, warningLog } = require('../utils/logger');

let shuttingDown = false;
let installed = false;
let originalExit = process.exit;
let loginPhase = null;
let transientWsHook = null;

const TRANSIENT_WS_RE = /WebSocket was closed before the connection was established|Connection Closed/i;

exports.setLoginPhase = (phase) => {
  loginPhase = phase ? String(phase) : null;
};

exports.getLoginPhase = () => loginPhase;

exports.onTransientWsError = (fn) => {
  transientWsHook = typeof fn === 'function' ? fn : null;
};

async function waitCycleLock(timeoutMs) {
  const cycleLock = require('../utils/cycleLock');
  const deadline = Date.now() + timeoutMs;
  while (cycleLock.isBusy() && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function flushAll() {
  try {
    runtimeSnapshot.save({ shutdown: true });
  } catch {
    /* ignore */
  }
  try {
    require('../utils/debouncedStore').flushAll();
  } catch {
    /* ignore */
  }
}

exports.isShuttingDown = () => shuttingDown;

exports.requestShutdown = async (reason = 'signal') => {
  if (shuttingDown) return;
  shuttingDown = true;

  try {
    require('./reconnectControl').abort();
  } catch {
    /* ignore */
  }

  infoLog(`Shutdown gracioso (${reason})…`);

  try {
    require('./checkpoints').record('before_shutdown', { reason });
  } catch {
    /* ignore */
  }

  const drainMs = cfg.SHUTDOWN_DRAIN_MS ?? 12000;

  try {
    require('./queueManager').freeze();
  } catch {
    /* ignore */
  }

  try {
    require('./groupEventScheduler').stop();
  } catch {
    /* ignore */
  }

  await waitCycleLock(drainMs);

  try {
    const qm = require('./queueManager');
    const drained = await qm.waitForDrain(drainMs);
    if (!drained) warningLog(`Shutdown: ${qm.getActiveJobs()} job(s) ainda ativo(s) após drain`);
  } catch {
    /* ignore */
  }

  try {
    require('../bot').stop?.();
  } catch {
    /* ignore */
  }

  try {
    await require('./socketRegistry').close();
  } catch {
    /* ignore */
  }

  processHeartbeat.stop();

  try {
    processHeartbeat.markCleanExit();
  } catch {
    /* ignore */
  }

  try {
    require('./persistence').shutdown();
  } catch {
    /* ignore */
  }

  persistentLocks.releaseOwned();
  try {
    require('./singleInstance').release();
  } catch {
    /* ignore */
  }
  await flushAll();
};

exports.install = () => {
  if (installed) return;
  installed = true;

  process.exit = (code) => {
    if (!shuttingDown) {
      exports.requestShutdown('process.exit').finally(() => originalExit.call(process, code));
      return;
    }
    originalExit.call(process, code);
  };

  const handler = (sig) => {
    exports.requestShutdown(sig).finally(() => originalExit.call(process, 0));
  };

  process.on('SIGINT', () => handler('SIGINT'));
  process.on('SIGTERM', () => handler('SIGTERM'));

  if (process.env.HANORK_ZERO_WORKER === '1' || process.env.WA_DIVULGACAO_USER === '1') {
    process.on('SIGHUP', () => {
      warningLog('SIGHUP ignorado — worker WhatsApp continua em background');
    });
  }

  process.on('uncaughtException', async (err) => {
    const msg = err?.message || String(err);
    const code = err?.code;

    if (code === 'EIO' || /^read EIO$/i.test(msg)) {
      await exports.requestShutdown('EIO');
      originalExit.call(process, 0);
      return;
    }

    if (TRANSIENT_WS_RE.test(msg)) {
      if (loginPhase && typeof transientWsHook === 'function') {
        warningLog(`Login WA (${loginPhase}): ${msg} — retentando`);
        try {
          transientWsHook(err);
        } catch {
          /* ignore */
        }
        return;
      }
      try {
        store.setCritical('recoveryMode.json', {
          active: true,
          reason: 'ws_preconnect_closed',
          at: new Date().toISOString(),
        });
      } catch {
        /* ignore */
      }
      await exports.requestShutdown('ws_preconnect_closed');
      originalExit.call(process, 0);
      return;
    }

    const { errorLog } = require('../utils/logger');
    errorLog(`Exceção não tratada: ${msg}`);
    store.setCritical('recoveryMode.json', {
      active: true,
      reason: 'uncaughtException',
      at: new Date().toISOString(),
    });
    await exports.requestShutdown('uncaughtException');
    originalExit.call(process, 1);
  });

  process.on('unhandledRejection', (reason) => {
    const msg = reason?.message || reason?.stack || String(reason);
    if (/connection closed|connection was lost|stream errored/i.test(msg)) return;
    if (loginPhase && TRANSIENT_WS_RE.test(msg)) return;
    const { errorLog } = require('../utils/logger');
    errorLog(`Promise não tratada: ${msg}`);
    try {
      require('./metrics').inc('retries');
    } catch {
      /* ignore */
    }
  });
};

module.exports = exports;
