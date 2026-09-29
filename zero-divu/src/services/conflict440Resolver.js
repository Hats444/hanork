'use strict';

const cfg = require('../config/divulgacao');
const singleInstance = require('./singleInstance');
const reconnectControl = require('./reconnectControl');
const { sleepInterruptible } = require('../utils/sleep');
const { infoLog } = require('../utils/logger');

function shouldAbort() {
  return (
    reconnectControl.isAborted() ||
    require('./gracefulShutdownManager').isShuttingDown()
  );
}

/** Resolve conflito 440 localmente — sessão em disco não é apagada */
exports.autoResolve = async () => {
  if (cfg.RECONNECT_440_AUTO_RESOLVE === false) {
    return { evicted: 0 };
  }

  if (shouldAbort()) return { evicted: 0 };

  const evicted = await singleInstance.evictDuplicates('440');

  if (shouldAbort()) return { evicted };

  try {
    await require('./socketRegistry').close({
      hard: true,
      waitMs: cfg.RECONNECT_440_SOCKET_CLOSE_MS ?? 6000,
    });
  } catch {
    /* ignore */
  }

  const ghostMs = cfg.RECONNECT_440_GHOST_MS ?? 15000;
  if (ghostMs > 2000) {
    infoLog(
      `Aguardando ${Math.round(ghostMs / 1000)}s para o WhatsApp liberar a sessão anterior (sem apagar login)…`
    );
    const ghostOk = await sleepInterruptible(ghostMs, shouldAbort, 1000);
    if (!ghostOk || shouldAbort()) return { evicted };
  }

  if (evicted) {
    const settleOk = await sleepInterruptible(
      cfg.RECONNECT_440_DUPE_SETTLE_MS ?? 3000,
      shouldAbort,
      500
    );
    if (!settleOk || shouldAbort()) return { evicted };
  }

  singleInstance.touch();
  try {
    require('./connectionResilience').markGhostWaitDone();
  } catch {
    /* ignore */
  }
  return { evicted };
};

module.exports = exports;
