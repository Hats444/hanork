'use strict';

const logger = require('../config/logger');
const { CONFIG } = require('../config/config');

const LEVEL = Object.freeze({
    OK: 'ok',
    WARNING: 'warning',
    CRITICAL: 'critical',
});

/** @type {Map<string, { level: string, notifiedAt: number, lastBalance: number|null }>} */
const states = new Map();

function getState(stateKey) {
    const key = String(stateKey || 'default');
    if (!states.has(key)) {
        states.set(key, { level: LEVEL.OK, notifiedAt: 0, lastBalance: null });
    }
    return states.get(key);
}

function resetState(stateKey) {
    if (stateKey != null) {
        states.delete(String(stateKey));
        return;
    }
    states.clear();
}

function classifyBalance(balance, thresholds = {}) {
    const n = Number(balance);
    if (!Number.isFinite(n)) return { level: LEVEL.OK, balance: null };
    const critical = Number(thresholds.critical);
    const warn = Number(thresholds.warn);
    if (Number.isFinite(critical) && n < critical) return { level: LEVEL.CRITICAL, balance: n };
    if (Number.isFinite(warn) && n < warn) return { level: LEVEL.WARNING, balance: n };
    return { level: LEVEL.OK, balance: n };
}

function levelEmoji(level) {
    if (level === LEVEL.CRITICAL) return '🔴';
    if (level === LEVEL.WARNING) return '🟡';
    return '🟢';
}

function levelLabel(level) {
    if (level === LEVEL.CRITICAL) return 'CRÍTICO';
    if (level === LEVEL.WARNING) return 'BAIXO';
    return 'OK';
}

function getAdminIds() {
    const fromNotifier = global.adminActivityNotifier?.adminIds;
    if (Array.isArray(fromNotifier) && fromNotifier.length) {
        return [...new Set(fromNotifier)];
    }
    return [...new Set((CONFIG.ID_DONO || []).map(Number).filter((x) => x > 0))];
}

function resolveTelegram(bot) {
    return bot?.telegram || global.botInstance?.telegram || null;
}

async function sendBalanceAlertToAdmins(bot, html, keyboard = null) {
    const adminIds = getAdminIds();
    if (!adminIds.length) {
        logger.warn('[SupplierBalance] nenhum admin configurado');
        return { sent: 0 };
    }

    const telegram = resolveTelegram(bot);
    const extra = { parse_mode: 'HTML', disable_web_page_preview: true };
    if (keyboard) Object.assign(extra, keyboard);

    let sent = 0;
    if (telegram) {
        for (const adminId of adminIds) {
            try {
                await telegram.sendMessage(adminId, html, extra);
                sent++;
            } catch (e) {
                logger.warn('[SupplierBalance] falha PV', { adminId, detail: e.message });
            }
        }
    }

    if (sent === 0) {
        const notifier = global.adminActivityNotifier;
        if (notifier?.enabled) {
            const plain = html.replace(/<[^>]+>/g, '');
            for (const adminId of adminIds) {
                try {
                    const ok = await notifier.sendToAdmin(adminId, plain);
                    if (ok) sent++;
                } catch {
                    logger.warn('[SupplierBalance] fallback notify falhou', { adminId });
                }
            }
        }
    }

    if (sent > 0) {
        logger.info('[SupplierBalance] admin notificado', { admins: sent });
    }
    return { sent };
}

/**
 * @param {string} stateKey
 * @param {string} level
 * @param {number|null} balance
 * @param {{ enabled?: boolean, warnThreshold: number, criticalThreshold: number, warnCooldownMs: number, criticalCooldownMs: number }} config
 */
function shouldNotifyMonitor(stateKey, level, balance, config) {
    if (config.enabled === false) return { notify: false };

    const monitorState = getState(stateKey);
    const now = Date.now();
    const prev = monitorState.level;

    if (level === LEVEL.OK) {
        if (prev !== LEVEL.OK) {
            Object.assign(monitorState, { level: LEVEL.OK, notifiedAt: now, lastBalance: balance });
            return { notify: true, kind: 'recovery' };
        }
        monitorState.lastBalance = balance;
        return { notify: false };
    }

    const cooldownMs =
        level === LEVEL.CRITICAL ? config.criticalCooldownMs : config.warnCooldownMs;

    const levelChanged = prev !== level;
    const cooldownExpired = now - monitorState.notifiedAt >= cooldownMs;
    const crossedDown =
        monitorState.lastBalance != null &&
        Number.isFinite(balance) &&
        monitorState.lastBalance >= config.warnThreshold &&
        balance < config.warnThreshold;

    if (levelChanged || cooldownExpired || crossedDown) {
        Object.assign(monitorState, { level, notifiedAt: now, lastBalance: balance });
        return { notify: true, kind: level };
    }

    monitorState.lastBalance = balance;
    return { notify: false };
}

module.exports = {
    LEVEL,
    getState,
    resetState,
    classifyBalance,
    levelEmoji,
    levelLabel,
    getAdminIds,
    resolveTelegram,
    sendBalanceAlertToAdmins,
    shouldNotifyMonitor,
};
