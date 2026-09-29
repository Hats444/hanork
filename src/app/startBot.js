'use strict';

const fsSync = require('fs');

/**
 * B3 M5 — bootstrap assíncrono: DB, Express, polling, schedulers pós-boot.
 * @param {object} deps — dependências montadas em bot.js (composição root).
 */
async function startBot(deps) {
    const bootMetrics = require('../modules/health/bootMetrics');
    bootMetrics.markBootStart();

    const {
        monitor,
        migrateFromJSON,
        prisma,
        logger,
        dbRaw,
        PaymentService,
        BackupManager,
        bot,
        antiSpam,
        state,
        carrinhos,
        comprasPendentes,
        bannedUsers,
        CONFIG,
        warmMenuPhotoCache,
        expressApp,
        HTTP_PORT,
        startExpressServer,
        registry,
        getZeroDivuPlugin,
        setBootComplete,
        setBotUsername,
        getBotUsername,
        botInstanceLock,
        adminActivityNotifier,
        deferBackground,
        autoBroadcastService,
        groupService,
        bridgePoolService,
        MP,
        SafeWebhookHandler,
        SafeDeliveryService,
        mpAmountMatchesOrder,
        loadProducts,
        deliverySlotStore,
        CustomerSubscriptionService,
        QueueService,
        webhookPaymentDedup,
    } = deps;

    const { recoverPendingPayments } = require('../jobs/startupRecovery');

    try {
        monitor.registerGlobalHandlers();

        migrateFromJSON();

        await prisma.$connect();
        logger.info('SQLite OK');

        try {
            const cleared = prisma.checkoutCooldown.cleanupExpired();
            if (cleared > 0) logger.info(`[Checkout] Cooldowns limpos na startup: ${cleared}`);
        } catch (e) {
            logger.warn('[Checkout] Limpeza cooldown: ' + e.message);
        }

        try {
            const migrated = dbRaw().prepare("UPDATE orders SET status = 'FAILED' WHERE status = 'CANCELLED'").run();
            if (migrated.changes > 0) {
                logger.info(`[ORDER] Migrados ${migrated.changes} pedido(s) CANCELLED → FAILED`);
            }
        } catch (e) {
            logger.warn('[ORDER] Migração status: ' + e.message);
        }

        const mpCheck = await PaymentService.verifyConnection();
        if (mpCheck.ok) {
            if (mpCheck.offlineVerify) {
                logger.warn('[PAYMENT] Mercado Pago ativo (TOKEN_MP ok; validação online falhou por rede/timeout)', {
                    reason: mpCheck.reason,
                });
            } else {
                logger.info('[PAYMENT] Mercado Pago conectado', {
                    mpUserId: mpCheck.mpUserId,
                    testMode: mpCheck.testMode,
                    country: mpCheck.country,
                });
            }
        } else {
            logger.error('[PAYMENT] Mercado Pago OFF — verifique TOKEN_MP no .env', {
                reason: mpCheck.reason,
                status: mpCheck.status,
            });
        }

        try {
            BackupManager.startScheduler({ intervalHours: parseInt(process.env.BACKUP_INTERVAL_HOURS || '6', 10) });
        } catch (e) {
            logger.warn('BackupManager scheduler: ' + e.message);
        }

        try {
            const { registerProcessors } = require('../modules/queue/worker');
            try {
                const { resetPvBroadcastQueueOnBoot } = require('../services/broadcastPvQueue');
                await resetPvBroadcastQueueOnBoot();
            } catch (e) {
                logger.warn('[BROADCAST] purge PV queue on boot: ' + e.message);
            }
            try {
                const { resetCatalogAiQueueOnBoot } = require('../plugins/zero-divu/catalogAiSync');
                await resetCatalogAiQueueOnBoot();
            } catch {
                /* zero-divu opcional */
            }
            registerProcessors(bot);
            logger.info('Queue System OK (Bull + Redis)');
        } catch (e) {
            logger.warn(`Queue System not available: ${e.message}`);
        }

        antiSpam.initDb(dbRaw());

        const saved = state.load();
        if (saved) {
            if (saved.carrinhos) {
                for (const [k, v] of saved.carrinhos) {
                    const m = Array.isArray(v) ? v : [...(new Map(v)).values()];
                    await carrinhos.set(k, m);
                }
            }
            if (saved.comprasPendentes) for (const [k, v] of saved.comprasPendentes) await comprasPendentes.set(k, v);
            if (saved.bannedUsers) for (const id of saved.bannedUsers) {
                bannedUsers.add(id);
                antiSpam.banUser(id, true);
            }
            logger.info(`Estado restaurado: ${bannedUsers.size} banidos (carrinhos/compras migrados para Redis/SQLite)`);
            state.clear();
        }

        for (const dir of [CONFIG.CAMINHO_PRODUTOS, CONFIG.CAMINHO_FOTOS, CONFIG.CAMINHO_INFOS]) {
            if (!fsSync.existsSync(dir)) fsSync.mkdirSync(dir, { recursive: true });
        }
        const menuPhotos = warmMenuPhotoCache();
        if (menuPhotos.length) {
            logger.info(`[Menu] ${menuPhotos.length} foto(s) de menu em infos/ (menu.jpg, menu2.jpg, …)`);
        } else {
            logger.warn('[Menu] Nenhum menu*.jpg em infos/ — menus no PV podem ir só em texto');
        }
        logger.info('[Media] caminhos resolvidos', {
            fotos: CONFIG.CAMINHO_FOTOS,
            infos: CONFIG.CAMINHO_INFOS,
        });
        try {
            const { listValidScreenFiles } = require('../telegram/screenPhoto');
            const screenPhotos = listValidScreenFiles();
            if (screenPhotos.length) {
                logger.info(`[Screen] ${screenPhotos.length} capa(s) válida(s) em assets/images/`);
            } else {
                logger.warn(
                    '[Screen] Nenhuma capa válida em assets/images/ (placeholders <4KB ignorados) — SMM e telas usam infos/menu*.jpg'
                );
            }
        } catch {
            /* ignore */
        }

        startExpressServer(expressApp, {
            port: HTTP_PORT,
            logger,
        });

        const dropPending = process.env.TELEGRAM_DROP_PENDING === '1';
        const { launchWithRecovery } = require('../telegram/pollingRecovery');
        const { prepareTelegramPolling, isWsl } = require('../telegram/telegramPollingPreflight');
        const { isTelegramNetworkError } = require('../telegram/telegramNetwork');
        await prepareTelegramPolling(bot.telegram, { dropPending });
        if (dropPending) {
            logger.warn(
                '[UpdateRecovery] TELEGRAM_DROP_PENDING=1 — mensagens pendentes na fila do Telegram serão descartadas neste boot'
            );
        } else {
            logger.info('[UpdateRecovery] modo retenção — updates pendentes serão recuperados antes do polling');
        }
        logger.info('Webhook removido / polling anterior limpo');
        if (isWsl()) {
            logger.info(
                '[BOT] WSL: use apenas UMA instância (WSL ou Windows, não os dois). ' +
                'Duplicata no Windows é encerrada automaticamente se detectada.'
            );
        }

        const launchBot = async (retries = 10) => {
            const { resetPollingState } = require('../telegram/pollingRecovery');
            for (let i = 0; i < retries; i++) {
                resetPollingState();
                try {
                    bot.stop('launch-retry');
                } catch {
                    /* ignore */
                }
                await prepareTelegramPolling(bot.telegram, { dropPending: i > 0 && dropPending });
                await launchWithRecovery(bot, dropPending);
                await new Promise((r) => setTimeout(r, 1200));
                try {
                    await bot.telegram.getMe();
                    logger.info('[BOT] Polling Telegram ativo');
                    return;
                } catch (e) {
                    const msg = e?.description || e?.message || '';
                    const is409 = msg.includes('409') || msg.includes('Conflict');
                    const isNet = isTelegramNetworkError(e);
                    if (is409 || isNet) {
                        const wait = Math.min((i + 1) * 4000, 20000);
                        logger.warn(`Falha ao conectar (${is409 ? '409 Conflict' : 'rede'}). Retry em ${wait / 1000}s… (${i + 1}/${retries})`);
                        resetPollingState();
                        try {
                            bot.stop('launch-retry');
                        } catch {
                            /* ignore */
                        }
                        await prepareTelegramPolling(bot.telegram, { dropPending });
                        await new Promise((r) => setTimeout(r, wait));
                    } else {
                        throw e;
                    }
                }
            }
            throw new Error('Não foi possível iniciar após várias tentativas. Verifique se há outra instância rodando.');
        };

        let menuCmdCount = 0;
        try {
            const { USER_COMMANDS } = require('../telegram/commands/botCommandsCatalog');
            const menuCmds = ['help', 'comandos', 'catalogo', 'numeros', 'carrinho', 'checkout', 'cupom', 'rastrear', 'suporte', 'afiliado', 'email', 'gmail', 'meusdados', 'tour'];
            menuCmdCount = menuCmds.length;
            await bot.telegram.setMyCommands(
                menuCmds.map((name) => {
                    const item = USER_COMMANDS.find((c) => c.cmd === `/${name}`);
                    return {
                        command: name,
                        description: (item?.desc || name).slice(0, 256),
                    };
                })
            );
        } catch (e) {
            logger.warn('[BOT] setMyCommands:', e.message);
        }
        let pingMs = null;
        const pingStart = Date.now();
        try {
            const me = await bot.telegram.getMe();
            setBotUsername(me.username || '');
            pingMs = Date.now() - pingStart;
        } catch {
            /* getMe falhou — bot pode ainda responder updates */
        }
        const prodCount = (await loadProducts()).length;
        let userCount = 0;
        try {
            userCount = await prisma.user.count();
        } catch (e) {
            logger.warn('[BOOT] user.count indisponível — stats parciais', { detail: e.message });
        }
        const pkg = require('../../package.json');
        const promoSlots = deliverySlotStore.count();
        const zeroDivuPlugin = getZeroDivuPlugin();
        try {
            require('../jobs/schedulers/cronBootLog').flush(logger);
        } catch {
            /* ignore */
        }
        logger.bootstrap({
            noBanner: true,
            version: `v${pkg.version}`,
            callbacks: registry.stats.registered,
            commands: menuCmdCount,
            admins: CONFIG.ID_DONO.length,
            products: prodCount,
            users: userCount,
            botUsername: getBotUsername(),
            port: HTTP_PORT,
            pingMs,
            plugins: zeroDivuPlugin
                ? 'core+saas+queue+zero-divu'
                : require('../plugins/zero-divu/config').isZeroDivuEnabled()
                  ? 'core+saas+queue (zero-divu erro)'
                  : 'core+saas+queue',
            zeroDivu: zeroDivuPlugin ? 'ON' : require('../plugins/zero-divu/config').isZeroDivuEnabled() ? 'ERRO' : 'OFF',
            promoSlots,
        });
        setBootComplete();
        await launchBot();
        bootMetrics.markBootReady();
        logger.info('[BOOT] pronto', bootMetrics.getBootSnapshot());
        try {
            botInstanceLock.refreshLockPid();
        } catch {
            /* ignore */
        }

        try {
            await adminActivityNotifier?.verifyStartup?.();
        } catch (e) {
            logger.warn('[ADMIN_NOTIFY] verify:', e.message);
        }

        try {
            const GptQueue = require('../services/GptRequestQueue');
            GptQueue.setBootComplete();
            logger.info('[ZeroTwo AI] boot guard encerrado', GptQueue.getStats());
        } catch (e) {
            logger.warn('[ZeroTwo AI] boot guard:', e.message);
        }

        deferBackground('zerotwo-dns-check', async () => {
            try {
                const { checkZerotwoApiDns } = require('../config/zerotwoReachability');
                await checkZerotwoApiDns(logger);
            } catch (e) {
                logger.warn('[ZeroTwo AI] dns check:', e.message);
            }
        });

        try {
            const aiSupport = require('../config/ai-support');
            const aiMode = aiSupport.describeMode?.();
            if (aiMode?.message) {
                logger.info('[AI] ' + aiMode.message, aiMode.gate || {});
            }
            const OllamaAi = require('../services/OllamaAiService');
            const localAiPolicy = require('../config/localAiPolicy');
            if (!localAiPolicy.isLocalAiEnvEnabled() && (await OllamaAi.isReachable())) {
                const { total } = localAiPolicy.memStatsMb();
                logger.warn(
                    '[AI] Ollama rodando na máquina mas USE_LOCAL_AI=0 — pode travar o WSL com pouca RAM',
                    { totalRamMb: total, hint: 'systemctl stop ollama' }
                );
            }
        } catch (e) {
            logger.debug('[AI] boot skip:', e.message);
        }

        try {
            const hanorkAiCore = require('../core/hanorkAiCore');
            if (hanorkAiCore.isAiCoreEnabled()) {
                const meta = hanorkAiCore.getRegistryMeta();
                logger.info('[HanorkAiCore] B4 ATIVO', {
                    prompts: meta.version,
                    tools: hanorkAiCore.toolRegistry.getRegistryMeta().count,
                    hash: meta.hash,
                });
            }
        } catch (e) {
            logger.debug('[HanorkAiCore] boot skip:', e.message);
        }

        deferBackground('zero-divu-worker', () => {
            try {
                const spawn = require('../plugins/zero-divu/spawnZeroWorker');
                spawn.maybeStart();
                spawn.startConnectionWatchdog();
            } catch (e) {
                logger.warn('[ZERO] spawn worker:', e.message);
            }
        });

        const bridgeDelayMs = Math.max(30000, parseInt(process.env.BRIDGE_AUTO_BOOT_DELAY_MS || '90000', 10));
        setTimeout(() => {
            deferBackground('bridge-auto', async () => {
                try {
                    const { runOnBoot } = require('../services/BridgeAutoService');
                    await runOnBoot(bot, CONFIG.ID_DONO, dbRaw);
                    if (require('../services/TelegramUserBridge').isConfigured()) {
                        bridgePoolService.startMaintenance();
                        bridgePoolService.startLinkWatcher().catch((e) =>
                            logger.warn('[BridgePool] link watcher:', e.message)
                        );
                        bridgePoolService.processQueue().catch((e) =>
                            logger.warn('[BridgePool] processQueue:', e.message)
                        );
                    }
                } catch (e) {
                    logger.warn('[BridgeAuto] boot:', e.message);
                }
            });
        }, bridgeDelayMs);
        logger.info(`[BridgeAuto] ponte MTProto agendada em ${Math.round(bridgeDelayMs / 1000)}s (comandos têm prioridade)`);

        logger.info('[DeliverySlot] mensagens rastreadas no banco (grupos/PV)', { total: promoSlots });

        monitor.init(bot, CONFIG.ID_DONO);
        monitor.startHealthCheck(async () => {
            const today = new Date().toISOString().slice(0, 10);
            const orders = (await prisma.order.findMany({ where: { status: 'DELIVERED' } }))
                .filter(o => o.updated_at && o.updated_at.startsWith(today));
            const revenue = orders.reduce((s, o) => s + (o.total || 0), 0);
            return { users: await prisma.user.count(), orders: orders.length, revenue: revenue.toFixed(2) };
        });

        autoBroadcastService.start();

        deferBackground('sync-groups', async () => {
            if (!groupService?.syncAllGroups) return;
            groupService.repairBridgePromoGroups?.();
            const r = await groupService.syncAllGroups();
            logger.info(
                `[GROUP] sync: gruposAtivos=${r.ok} inativos=${r.failed} botAdminEm=${r.withAdmin} total=${r.total} (não é ID_DONO)`
            );
        });

        setTimeout(
            () =>
                deferBackground('recover-payments', () =>
                    recoverPendingPayments({
                        prisma,
                        MP,
                        bot,
                        logger,
                        SafeWebhookHandler,
                        SafeDeliveryService,
                        mpAmountMatchesOrder,
                        webhookPaymentDedup,
                        deferBackground,
                        dbRaw,
                    })
                ),
            Math.max(15000, parseInt(process.env.RECOVER_BOOT_DELAY_MS || '45000', 10))
        );

        const { registerPostBootSchedulers } = require('../jobs/registerAllSchedulers');
        registerPostBootSchedulers({
            bot,
            prisma,
            dbRaw,
            logger,
            state,
            carrinhos,
            comprasPendentes,
            bannedUsers,
            CustomerSubscriptionService,
            QueueService,
            CONFIG,
        });
    } catch (e) {
        const detail = e.message || e.code || e.type || String(e);
        const { isTelegramNetworkError } = require('../telegram/telegramNetwork');

        if (isTelegramNetworkError(e)) {
            logger.error(
                `[BOOT] Telegram indisponível no boot: ${detail} — HTTP/filas/WA seguem; polling será re tentado em background`
            );
            try {
                const dropPending = process.env.TELEGRAM_DROP_PENDING === '1';
                const { schedulePollingRestart } = require('../telegram/pollingRecovery');
                schedulePollingRestart(bot, dropPending, 30000);
            } catch {
                /* ignore */
            }
            try {
                setBootComplete();
            } catch {
                /* ignore */
            }
            return;
        }

        logger.fatal(`FATAL startBot: ${detail}${e.code ? ` [${e.code}]` : ''}${e.errno ? ` errno=${e.errno}` : ''}`);
        if (detail.includes('api.telegram.org') || e.code === 'ECONNREFUSED' || e.code === 'ENOTFOUND' || e.type === 'system') {
            logger.fatal('>> Sem conexão com a API do Telegram. Verifique: internet, DNS, firewall ou bloqueio do provedor.');
        }
        await monitor.alertCrash(e, 'startBot').catch(() => { });
        process.exit(1);
    }
}

module.exports = { startBot };
