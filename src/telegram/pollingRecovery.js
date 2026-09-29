'use strict';

/**
 * Reinicia polling Telegram após erro 409 (instância duplicada) ou queda de rede.
 */
const logger = require('../config/logger');
const updateRecovery = require('./updateRecovery');

const ALLOWED_UPDATES = ['message', 'callback_query', 'chat_member', 'my_chat_member', 'channel_post'];

let _restartTimer = null;
let _restarting = false;
let _pollingModeLogged = false;
let _pollingLaunched = false;
let _409Burst = 0;
let _409BurstAt = 0;
let _409Total = 0;
const MAX_409_RESTARTS = 4;
const BURST_WINDOW_MS = 120000;

async function cleanWebhook(telegram, dropPending) {
    for (let t = 0; t < 3; t++) {
        try {
            await telegram.deleteWebhook({ drop_pending_updates: dropPending });
            break;
        } catch {
            /* retry */
        }
        await new Promise((r) => setTimeout(r, 500));
    }
    try {
        const wh = await telegram.getWebhookInfo();
        if (wh.url) {
            logger.warn('[BOT] Webhook Telegram ainda ativo — updates podem não chegar no polling', {
                url: wh.url,
                pending: wh.pending_update_count,
            });
            await telegram.deleteWebhook({ drop_pending_updates: dropPending });
        } else if (!_pollingModeLogged) {
            _pollingModeLogged = true;
            logger.info('[BOT] Modo polling', {
                pendingUpdates: wh.pending_update_count ?? 0,
                dropPending,
            });
        }
    } catch (e) {
        logger.warn('[BOT] getWebhookInfo:', e.message);
    }
}

function onPollingEnded(bot, dropPending, err) {
    const msg = err?.description || err?.message || String(err);
    if (msg.includes('Bot stopped') || msg.includes('SIGINT') || msg.includes('SIGTERM') || msg.includes('polling-restart')) {
        _pollingLaunched = false;
        return;
    }
    const is409 = msg.includes('409') || msg.includes('Conflict');
    logger.error('[BOT] Polling encerrado:', msg);
    if (is409) {
        _409Total += 1;
        const now = Date.now();
        if (now - _409BurstAt > BURST_WINDOW_MS) {
            _409Burst = 0;
            _409BurstAt = now;
        }
        _409Burst += 1;
        if (_409Burst > MAX_409_RESTARTS) {
            logger.error(
                '[BOT] 409 repetido — outro processo está usando o mesmo token. ' +
                'Encerre todas as cópias (node src/bot.js, PM2, outro terminal) e suba só uma.'
            );
            _pollingLaunched = false;
            return;
        }
        logger.warn(
            `[BOT] Conflito 409 (${_409Burst}/${MAX_409_RESTARTS}) — reiniciando polling em 12s. ` +
            'Use uma única instância: node src/bot.js'
        );
    }
    _pollingLaunched = false;
    schedulePollingRestart(bot, dropPending, is409 ? 12000 : 15000);
}

function schedulePollingRestart(bot, dropPending, delayMs = 8000) {
    if (_restartTimer) return;
    _restartTimer = setTimeout(async () => {
        _restartTimer = null;
        try {
            await restartPolling(bot, dropPending);
        } catch (e) {
            logger.error('[BOT] Falha ao reiniciar polling:', e.message);
            schedulePollingRestart(bot, dropPending, Math.min(delayMs * 2, 60000));
        }
    }, delayMs);
}

async function restartPolling(bot, dropPending) {
    if (_restarting) return;
    _restarting = true;
    try {
        try {
            const { killDuplicateHanorkPollers } = require('./telegramPollingPreflight');
            await killDuplicateHanorkPollers();
        } catch {
            /* ignore */
        }
        try {
            bot.stop('polling-restart');
        } catch {
            /* ignore */
        }
        await new Promise((r) => setTimeout(r, 12000));
        try {
            const { prepareTelegramPolling } = require('./telegramPollingPreflight');
            const dropOnRestart = updateRecovery.shouldDropPending();
            await prepareTelegramPolling(bot.telegram, { dropPending: dropOnRestart });
        } catch {
            await cleanWebhook(bot.telegram, updateRecovery.shouldDropPending());
        }
        resetPollingState();
        await launchWithRecovery(bot, updateRecovery.shouldDropPending());
        await new Promise((r) => setTimeout(r, 1500));
        await bot.telegram.getMe();
        logger.info('[BOT] Polling reiniciado com sucesso');
    } finally {
        _restarting = false;
    }
}

async function launchWithRecovery(bot, dropPending) {
    if (_pollingLaunched) return;
    _pollingLaunched = true;
    const drop = dropPending === true;
    try {
        if (!drop && updateRecovery.isRecoveryEnabled()) {
            await updateRecovery.recoverPendingUpdatesOnBoot(bot, bot.telegram, {
                allowedUpdates: ALLOWED_UPDATES,
            });
        }
    } catch (e) {
        logger.warn('[UpdateRecovery] drain pré-launch falhou (seguindo com polling):', e.message);
    }
    bot
        .launch({
            allowedUpdates: ALLOWED_UPDATES,
            dropPendingUpdates: drop,
        })
        .catch((e) => onPollingEnded(bot, dropPending, e));
}

function resetPollingState() {
    _pollingLaunched = false;
    _restarting = false;
    if (_restartTimer) {
        clearTimeout(_restartTimer);
        _restartTimer = null;
    }
}

function getPollingMetrics() {
    return {
        pollingActive: _pollingLaunched ? 1 : 0,
        conflicts409Total: _409Total,
        conflicts409Burst: _409Burst,
        restarting: _restarting ? 1 : 0,
        updateRecovery: updateRecovery.getRecoveryMetrics(),
    };
}

module.exports = {
    ALLOWED_UPDATES,
    cleanWebhook,
    launchWithRecovery,
    onPollingEnded,
    schedulePollingRestart,
    restartPolling,
    resetPollingState,
    getPollingMetrics,
};
