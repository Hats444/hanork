'use strict';

const { ZERO_DIVU_CONFIG, isZeroDivuEnabled } = require('./config');
const {
  syncHanorkCatalogToZero,
  wireAutoBroadcastSync,
  catalogUsesAi,
  catalogUsesAsyncAi,
} = require('./hanorkAutoSync');
const { setCatalogDeps } = require('./catalogDeps');
const { registerZeroDivuCommands } = require('./ZeroDivuCommands');
const { registerZeroDivuContent } = require('./ZeroDivuContentCommands');
const { registerZeroDivuAdminPanel } = require('./zeroDivuAdminPanel');
const { registerZeroDivuPromo } = require('./promo');
const { registerWaCustomBlast } = require('./waCustomBlast');
const { registerWaPromoPhotoUpload } = require('./waPromoPhotoUpload');
const { registerAdminOpsHandlers } = require('./adminOpsHandlers');
const { registerDualWaConnectCommands } = require('./waRegisterConnectCommands');
const { isDualWaEnabled } = require('./waSessionsManifest');
const { getZeroDivuLoginService } = require('./ZeroDivuLoginService');
const waBlastTracker = require('./waBlastTracker');
const { startZeroDivuLogBridge } = require('./zeroDivuLogBridge');
const { getZeroDivuClient } = require('./ZeroDivuClient');

function registerHandlers(bot, deps) {
  const { isAdmin, Msg, Markup, logger, deferBackground } = deps;

  registerZeroDivuCommands(bot, {
    isAdmin,
    Msg,
    logger,
    deferBackground,
    syncHanorkCatalog: (opts) => syncHanorkCatalogToZero(deps, opts),
  });
  registerZeroDivuContent(bot, { isAdmin, Msg, logger, deferBackground });
  const promoDeps = {
    isAdmin,
    Msg,
    Markup,
    logger,
    deferBackground,
    loadProducts: deps.loadProducts,
    prisma: deps.prisma,
    broadcastService: deps.broadcastService,
    autoBroadcastService: deps.autoBroadcastService,
    executeFullBroadcast: deps.executeFullBroadcast,
    runBridgePromoAfterBot: deps.runBridgePromoAfterBot,
    BroadcastService: deps.BroadcastService,
    sendProgressPanel: deps.sendProgressPanel,
    updateAdminPanelMessage: deps.updateAdminPanelMessage,
    CONFIG: deps.CONFIG,
  };
  registerZeroDivuPromo(bot, promoDeps);

  const logBridge = startZeroDivuLogBridge(logger, {
    bot,
    Msg,
    adminActivityNotifier: deps.adminActivityNotifier,
  });

  registerZeroDivuAdminPanel(bot, {
    isAdmin,
    Msg,
    Markup,
    logger,
    deferBackground,
    editAdminPanel: deps.editAdminPanel,
    logBridge,
    syncHanorkCatalog: (opts) => syncHanorkCatalogToZero(deps, opts),
  });

  waBlastTracker.init({ bot, logger, Markup });
  registerWaCustomBlast(bot, {
    isAdmin,
    Msg,
    Markup,
    logger,
    deferBackground,
    waBlastTracker,
  });
  registerWaPromoPhotoUpload(bot, {
    isAdmin,
    Msg,
    Markup,
    logger,
    deferBackground,
    editAdminPanel: deps.editAdminPanel,
  });

  registerAdminOpsHandlers(bot, {
    isAdmin,
    Msg,
    Markup,
    logger,
    editAdminPanel: deps.editAdminPanel,
  });

  if (isDualWaEnabled()) {
    registerDualWaConnectCommands(bot, {
      isAdmin,
      Msg,
      logger,
      deferBackground,
      login: getZeroDivuLoginService(),
    });
  }

  logger.info('Hanork WA UI: blast, mídia, ops e painel registrados', {
    category: 'HANORK',
    module: 'WA',
    dualSlashCommands: isDualWaEnabled(),
  });

  return logBridge;
}

function initZeroDivuPlugin(bot, deps) {
  if (!ZERO_DIVU_CONFIG.enabled) {
    (deps.logger || console).warn?.(
      '[ZeroDivu] DESLIGADO — adicione ZERO_DIVU_ENABLED=true no .env e reinicie'
    );
    return null;
  }

  const { logger, deferBackground } = deps;
  setCatalogDeps(deps);
  getZeroDivuClient().ensureDir();

  const ipcToken = ZERO_DIVU_CONFIG.ipcToken;
  if (ipcToken) {
    logger.info('[ZeroDivu] IPC autenticado — token incluído nos comandos', {
      category: 'HANORK',
      module: 'WA',
    });
  } else {
    logger.warn(
      '[ZeroDivu] ZERO_IPC_TOKEN ausente — comandos IPC sem autenticação (defina o mesmo valor no Hanork e no zero-divu)',
      { category: 'HANORK', module: 'WA' }
    );
  }

  // Botões /wa_* primeiro — não depender de sync ou serviços opcionais
  const logBridge = registerHandlers(bot, deps);

  try {
    wireAutoBroadcastSync(deps.autoBroadcastService, deps);
  } catch (e) {
    logger.warn('[ZeroDivu] Sync divulgação auto indisponível:', e.message);
  }

  const catalogDelayMs = Math.max(
    30000,
    Number(process.env.HANORK_WA_CATALOG_SYNC_DELAY_MS) || 90000
  );
  const bootGuardMs = Math.max(0, Number(process.env.ZEROTWO_AI_BOOT_GUARD_MS) || 120000);

  deferBackground('wa-initial-catalog-sync', () => {
    const runWhenReady = () => {
      try {
        const GptQueue = require('../../services/GptRequestQueue');
        if (GptQueue.isBootGuardActive()) {
          setTimeout(runWhenReady, 10000);
          return;
        }
      } catch {
        /* ignore */
      }

      const useAsync = catalogUsesAi() && catalogUsesAsyncAi();
      const syncOpts = useAsync
        ? {
            asyncAi: true,
            source: 'boot',
            delayMs: catalogDelayMs + bootGuardMs,
          }
        : {};

      syncHanorkCatalogToZero(deps, syncOpts)
        .then((r) => {
          if (r?.ok) {
            if (r.asyncAi) {
              logger.info('Catálogo WA: job IA enfileirado (template + Bull ai:catalog)', {
                category: 'HANORK',
                module: 'WA',
                jobId: r.jobId,
                pending: r.pending,
              });
            } else {
              logger.info(`Catálogo divulgação auto → WhatsApp: ${r.count} produto(s)`, {
                category: 'HANORK',
                module: 'WA',
                mode: 'products_only',
              });
            }
          }
        })
        .catch((e) => logger.warn('[ZeroDivu] Sync inicial catálogo:', e.message));
    };
    setTimeout(runWhenReady, catalogDelayMs);
  });

  if (catalogUsesAi() && !catalogUsesAsyncAi()) {
    const retryMs = Math.max(
      300000,
      Number(process.env.HANORK_WA_CATALOG_AI_RETRY_MS) || catalogDelayMs + bootGuardMs + 180000
    );
    deferBackground('wa-catalog-ai-retry', () => {
      setTimeout(() => {
        const GptQueue = require('../../services/GptRequestQueue');
        if (GptQueue.isRateLimited?.() || GptQueue.isBootGuardActive?.()) {
          logger.info('[ZeroDivu] Retry catálogo IA adiado — cooldown ativo', {
            category: 'HANORK',
            module: 'WA',
          });
          return;
        }
        syncHanorkCatalogToZero(deps, { useAi: true, skipAsyncEnqueue: true })
          .then((r) => {
            if (r?.ok) {
              logger.info(`Catálogo WA (retry IA): ${r.count} produto(s)`, {
                category: 'HANORK',
                module: 'WA',
              });
            }
          })
          .catch((e) => logger.warn('[ZeroDivu] Retry catálogo IA:', e.message));
      }, retryMs);
    });
  }

  logger.info('[ZeroDivu] Modo divulgação: só produtos cadastrados Hanork (campanha Zero desativada)', {
    category: 'HANORK',
    module: 'WA',
    catalogAiMode: catalogUsesAi()
      ? catalogUsesAsyncAi()
        ? 'bull_async'
        : 'sync_sequential'
      : 'template',
  });

  logger.info('Plugin Zero Divu ativo (IPC WhatsApp)', {
    category: 'HANORK',
    module: 'WA',
    ipcDir: ZERO_DIVU_CONFIG.ipcDir,
    dbMode: ZERO_DIVU_CONFIG.useSharedHanorkDb ? 'shared_hanork' : 'separate',
    workerDb: ZERO_DIVU_CONFIG.useSharedHanorkDb
      ? ZERO_DIVU_CONFIG.hanorkDbPath
      : ZERO_DIVU_CONFIG.zeroDivuDbPath,
  });

  return { logBridge, config: ZERO_DIVU_CONFIG, syncHanorkCatalogToZero };
}

module.exports = {
  initZeroDivuPlugin,
  registerZeroDivuHandlers: registerHandlers,
  registerProductBroadcastHandlers: require('./promo').registerProductBroadcastHandlers,
  ZERO_DIVU_CONFIG,
  isZeroDivuEnabled,
};
