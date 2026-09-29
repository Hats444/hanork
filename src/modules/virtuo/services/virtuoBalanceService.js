'use strict';

const { Markup } = require('telegraf');
const logger = require('../../../config/logger');
const SBM = require('../../../services/supplierBalanceMonitor');
const VirtuoApiClient = require('../providers/virtuoApiClient');
const VirtuoConfig = require('../virtuoConfig');
const { formatMoney } = require('../utils/virtuoTextFormat');

const STATE_KEY = 'virtuo';
const LEVEL = SBM.LEVEL;

function isMonitorEnabled() {
    const v = String(process.env.VIRTUO_BALANCE_MONITOR ?? '1').toLowerCase();
    return v !== '0' && v !== 'false';
}

function balanceThresholds() {
    return {
        warn: VirtuoConfig.balanceWarn,
        critical: VirtuoConfig.balanceCritical,
    };
}

function monitorNotifyConfig() {
    return {
        enabled: isMonitorEnabled(),
        warnThreshold: VirtuoConfig.balanceWarn,
        criticalThreshold: VirtuoConfig.balanceCritical,
        warnCooldownMs: VirtuoConfig.balanceWarnCooldownMs,
        criticalCooldownMs: VirtuoConfig.balanceCriticalCooldownMs,
    };
}

function classifyBalance(balance) {
    return SBM.classifyBalance(balance, balanceThresholds());
}

function parseVirtuoBalanceCents(raw) {
    const cents = Number(raw?.balance ?? raw);
    if (!Number.isFinite(cents)) return NaN;
    return cents / 100;
}

async function fetchVirtuoBalance() {
    if (!VirtuoConfig.apiKey) {
        return { ok: false, error: 'no_api_key' };
    }
    const resp = await VirtuoApiClient.getBalance();
    if (!resp.ok) {
        return { ok: false, error: resp.error?.message || resp.error?.code || 'balance_unavailable' };
    }
    const balance = parseVirtuoBalanceCents(resp.data);
    if (!Number.isFinite(balance)) {
        return { ok: false, error: 'balance_invalid', raw: resp.data };
    }
    const currency = resp.data?.currency || 'BRL';
    const classified = classifyBalance(balance);
    const key = VirtuoConfig.apiKey;
    const fingerprint = key.length > 8 ? `${key.slice(0, 4)}…${key.slice(-4)}` : '—';
    return {
        ok: true,
        balance,
        currency,
        level: classified.level,
        provider: 'virtuo',
        fingerprint,
        balanceFormatted: resp.data?.balanceFormatted || formatMoney(balance),
    };
}

function buildBalanceStatusHtml(snapshot, opts = {}) {
    const { balance, currency, level } = snapshot;
    const emoji = SBM.levelEmoji(level);
    const label = SBM.levelLabel(level);
    const warn = VirtuoConfig.balanceWarn;
    const crit = VirtuoConfig.balanceCritical;
    const rechargeUrl = VirtuoConfig.rechargeUrl;

    let body =
        `${emoji} <b>Saldo Hanork SMS (Virtuo) — ${label}</b>\n\n` +
        `💰 Atual: <b>${formatMoney(balance)}</b> ${currency}\n` +
        `⚠️ Aviso: &lt; ${formatMoney(warn)}\n` +
        `🔴 Crítico: &lt; ${formatMoney(crit)}\n`;

    if (opts.orderRef) {
        body += `\n📋 Pedido bloqueado: <b>${opts.orderRef}</b>\n`;
    }
    if (opts.detail) {
        body += `⚙️ <i>${String(opts.detail).slice(0, 160)}</i>\n`;
    }

    if (level === LEVEL.CRITICAL) {
        body +=
            `\n<b>Números SMS podem falhar agora.</b>\n` +
            `Recarregue no painel Virtuo.\n` +
            `🔗 <a href="${rechargeUrl}">Abrir painel para recarregar</a>`;
    } else if (level === LEVEL.WARNING) {
        body +=
            `\n<i>Saldo suficiente por pouco — considere recarregar antes do tráfego.</i>\n` +
            `🔗 <a href="${rechargeUrl}">Recarregar no painel</a>`;
    } else if (opts.showOkHint) {
        body += `\n<i>Saldo confortável para operação SMS.</i>`;
    }

    return body;
}

function adminBalanceKeyboard() {
    return Markup.inlineKeyboard([
        [{ text: '💳 Recarregar saldo', url: VirtuoConfig.rechargeUrl }],
        [
            { text: '🔄 Atualizar saldo', callback_data: 'virtuo:bal:refresh' },
            { text: '📊 Stats SMS', callback_data: 'virtuo:bal:stats' },
        ],
        [{ text: '📚 Doc API Virtuo', callback_data: 'virtuo:docs:0' }],
        [{ text: '💰 Saldo SMM', callback_data: 'smm:bal:refresh' }],
    ]);
}

async function notifyLowBalanceIfNeeded(bot, snapshot, opts = {}) {
    const decision = SBM.shouldNotifyMonitor(STATE_KEY, snapshot.level, snapshot.balance, monitorNotifyConfig());
    if (!decision.notify) {
        return { notified: false, skipped: decision.kind || 'cooldown' };
    }

    if (decision.kind === 'recovery') {
        const recoveryHtml =
            `🟢 <b>Saldo Virtuo SMS recuperado</b>\n\n` +
            `💰 Atual: <b>${formatMoney(snapshot.balance)}</b> ${snapshot.currency}\n` +
            `<i>Acima do limite de aviso (${formatMoney(VirtuoConfig.balanceWarn)}).</i>`;
        await SBM.sendBalanceAlertToAdmins(bot, recoveryHtml, adminBalanceKeyboard());
    } else {
        const html = buildBalanceStatusHtml(snapshot, {
            showOkHint: false,
            orderRef: opts.orderRef,
            detail: opts.detail,
        });
        await SBM.sendBalanceAlertToAdmins(bot, html, adminBalanceKeyboard());
    }

    return { notified: true, kind: decision.kind, level: snapshot.level };
}

async function notifyOrderBlockedForBalance(bot, { hanorkOrderId, balance, required, virtuoOrder }) {
    const snapshot = {
        balance: Number(balance),
        currency: 'BRL',
        level: classifyBalance(balance).level,
        provider: 'virtuo',
    };
    const ref = hanorkOrderId
        ? `#${String(hanorkOrderId).slice(-8)}`
        : virtuoOrder?.id
            ? `Virtuo #${virtuoOrder.id}`
            : '—';
    const detail = `necessário ${formatMoney(required)} · disponível ${formatMoney(balance)}`;

    Object.assign(SBM.getState(STATE_KEY), {
        level: snapshot.level,
        notifiedAt: Date.now(),
        lastBalance: snapshot.balance,
    });

    const html = buildBalanceStatusHtml(snapshot, { orderRef: ref, detail });
    await SBM.sendBalanceAlertToAdmins(bot, html, adminBalanceKeyboard());
    return { notified: true };
}

async function runBalanceMonitorCycle(bot) {
    if (!isMonitorEnabled()) {
        return { skipped: true, reason: 'disabled' };
    }
    if (!VirtuoConfig.apiKey) {
        return { skipped: true, reason: 'no_api_key' };
    }
    const snapshot = await fetchVirtuoBalance();
    if (!snapshot.ok) {
        logger.warn('[Virtuo:balance] consulta falhou', { detail: snapshot.error });
        return { ok: false, error: snapshot.error };
    }
    const result = await notifyLowBalanceIfNeeded(bot, snapshot);
    logger.info('[Virtuo:balance] monitor', {
        balance: snapshot.balance,
        level: snapshot.level,
        notified: result.notified,
    });
    return { ok: true, balance: snapshot.balance, level: snapshot.level, ...result };
}

async function assertBalanceForCost(requiredCost) {
    const required = Number(requiredCost);
    if (!Number.isFinite(required) || required <= 0) {
        return { ok: true, skipped: 'no_cost' };
    }
    if (!VirtuoConfig.apiKey) {
        return { ok: false, reason: 'balance_check_failed', detail: 'VIRTUO_API_KEY ausente' };
    }
    try {
        const snap = await fetchVirtuoBalance();
        if (!snap.ok) {
            return { ok: false, reason: 'balance_check_failed', detail: snap.error };
        }
        if (snap.balance < required) {
            return {
                ok: false,
                reason: 'insufficient_provider_balance',
                balance: snap.balance,
                required,
            };
        }
        return { ok: true, balance: snap.balance, required };
    } catch (e) {
        return { ok: false, reason: 'balance_check_failed', detail: e.message };
    }
}

function mapActivationErrorToReason(error) {
    const code = String(error?.code || error?.message || '').toUpperCase();
    if (/INSUFFICIENT|BALANCE|FUNDS|NO_MONEY|LOW_BALANCE/.test(code)) {
        return 'insufficient_provider_balance';
    }
    if (/NO_NUMBERS|OUT_OF_STOCK|UNAVAILABLE/.test(code)) {
        return 'out_of_stock';
    }
    return 'provider_rejected';
}

function _resetMonitorState() {
    SBM.resetState(STATE_KEY);
}

module.exports = {
    LEVEL,
    STATE_KEY,
    isMonitorEnabled,
    fetchVirtuoBalance,
    buildBalanceStatusHtml,
    adminBalanceKeyboard,
    notifyLowBalanceIfNeeded,
    notifyOrderBlockedForBalance,
    runBalanceMonitorCycle,
    assertBalanceForCost,
    mapActivationErrorToReason,
    classifyBalance,
    _resetMonitorState,
};
