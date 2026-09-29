'use strict';

/**
 * B3 M5 — shutdown único (merge dos dois handlers duplicados em bot.js).
 */
function registerGracefulShutdown(deps) {
    const {
        getBootComplete,
        logger,
        bot,
        botInstanceLock,
        monitor,
        state,
        carrinhos,
        comprasPendentes,
        bannedUsers,
        BackupManager,
        prisma,
        QueueService,
    } = deps;

    async function gracefulShutdown(signal) {
        if (!getBootComplete()) {
            console.warn(`[LOCK] ${signal} durante boot — ignorado (evita parar no meio do SQLite OK)`);
            return;
        }
        logger.info(`Shutting down (${signal})...`);
        try {
            require('../plugins/zero-divu/spawnZeroWorker').stopZeroWorker();
        } catch {
            /* ignore */
        }
        try {
            botInstanceLock.releaseLockHandle();
        } catch {
            /* ignore */
        }
        monitor.setBotStopped(true);
        try {
            bot.stop(signal);
        } catch {
            /* ignore */
        }

        try {
            await state.save(carrinhos, comprasPendentes, bannedUsers);
        } catch (e) {
            logger.error('Erro ao salvar estado:', e.message);
        }

        try {
            await BackupManager.createBackup('shutdown', true);
        } catch (e) {
            logger.error('Erro no backup durante shutdown:', e.message);
        }

        try {
            await QueueService.closeAll();
            logger.info('Queue system closed');
        } catch (e) {
            logger.error('Error closing queues:', e.message);
        }

        try {
            await prisma.$disconnect();
            logger.info('Prisma desconectado.');
        } catch (e) {
            logger.error('Erro ao desconectar Prisma:', e.message);
        }

        logger.info('Shutdown completo.');
        setTimeout(() => process.exit(0), 500);
    }

    process.once('SIGINT', () => gracefulShutdown('SIGINT'));
    process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));

    // Fechar terminal WSL/SSH envia SIGHUP — sem isso o Node encerra sem log de shutdown.
    process.on('SIGHUP', () => {
        if (!getBootComplete()) return;
        logger.warn(
            '[SYSTEM] SIGHUP recebido (terminal fechado?) — bot continua em background. ' +
                'Status: bash scripts/hanork-ctl.sh status'
        );
    });

    process.on('exit', (code) => {
        try {
            const fs = require('fs');
            const { resolveTerminalLogPath } = require('../logging/terminalMirror');
            const fp = resolveTerminalLogPath();
            if (fp) {
                fs.appendFileSync(
                    fp,
                    `[${new Date().toISOString()}] [SYSTEM] EXIT pid=${process.pid} code=${code}\n`
                );
            }
        } catch {
            /* ignore */
        }
    });
}

module.exports = { registerGracefulShutdown };
