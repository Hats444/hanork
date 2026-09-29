'use strict';

const { Markup } = require('telegraf');
const logger = require('../../../config/logger');
const SmmConfig = require('../smmConfig');
const { getProvider } = require('../providers/providerRegistry');
const ProviderManager = require('../providers/ProviderManager');
const { formatMoney } = require('../utils/smmTextFormat');
const SBM = require('../../../services/supplierBalanceMonitor');

const STATE_KEY = 'smm';
const LEVEL = SBM.LEVEL;

function isMonitorEnabled() {
    const v = String(process.env.SMM_BALANCE_MONITOR ?? '1').toLowerCase();
    return v !== '0' && v !== 'false';
}

function getWarnThreshold() {
    return SmmConfig.balanceWarnThreshold;
}

function getCriticalThreshold() {
    return SmmConfig.balanceCriticalThreshold;
}

function getRechargeUrl() {
    return SmmConfig.providerRechargeUrl;
}

function getAdminIds() {
    return SBM.getAdminIds();
}

function balanceThresholds() {
    return {
        warn: getWarnThreshold(),
        critical: getCriticalThreshold(),
    };
}

function monitorNotifyConfig() {
    return {
        enabled: isMonitorEnabled(),
        warnThreshold: getWarnThreshold(),
        criticalThreshold: getCriticalThreshold(),
        warnCooldownMs: SmmConfig.balanceWarnCooldownMs,
        criticalCooldownMs: SmmConfig.balanceCriticalCooldownMs,
    };
}

function classifyBalance(balance) {
    return SBM.classifyBalance(balance, balanceThresholds());
}

function levelEmoji(level) {
    return SBM.levelEmoji(level);
}

function levelLabel(level) {
    return SBM.levelLabel(level);
}

function parseBalanceValue(raw) {
    if (raw == null) return NaN;
    if (typeof raw === 'number') return raw;
    if (typeof raw === 'string') {
        const n = Number(String(raw).replace(/[^\d.,-]/g, '').replace(',', '.'));
        return Number.isFinite(n) ? n : NaN;
    }
    if (typeof raw === 'object') {
        if (raw.balance != null) return parseBalanceValue(raw.balance);
        if (raw.funds != null) return parseBalanceValue(raw.funds);
    }
    return NaN;
}

function normalizeProviderError(raw) {
    if (raw == null) return 'provider_error';
    if (raw.error === true) {
        const msg = raw.message;
        if (typeof msg === 'string' && msg && msg !== 'true' && msg !== 'false') return msg;
        return 'provider_balance_unavailable';
    }
    if (typeof raw.error === 'string' && raw.error && raw.error !== 'false' && raw.error !== '0') {
        return raw.error;
    }
    return 'provider_error';
}

function isProviderErrorResponse(raw) {
    if (!raw || typeof raw !== 'object') return false;
    if (raw.error === true) return true;
    if (typeof raw.error === 'string' && raw.error && !['false', '0', 'ok'].includes(raw.error.toLowerCase())) {
        return true;
    }
    return false;
}

async function fetchProviderBalance(providerOverride = null) {
    if (!providerOverride && ProviderManager.isDualProviderEnabled()) {
        const all = await ProviderManager.fetchAllBalances();
        const primary = all.find((b) => b.providerId === ProviderManager.PRIMARY_ID) || all[0];
        if (!primary) {
            return { ok: false, error: 'no_balance_api' };
        }
        if (!primary.ok) {
            const secondary = all.find((b) => b.providerId === ProviderManager.SECONDARY_ID && b.ok);
            if (secondary) {
                return {
                    ok: true,
                    balance: secondary.balance,
                    currency: secondary.currency,
                    level: classifyBalance(secondary.balance).level,
                    provider: secondary.providerId,
                    fingerprint: secondary.fingerprint,
                    dualSnapshot: all,
                };
            }
            return { ok: false, error: primary.error || 'provider_balance_unavailable', dualSnapshot: all };
        }
        return {
            ok: true,
            balance: primary.balance,
            currency: primary.currency,
            level: classifyBalance(primary.balance).level,
            provider: primary.providerId,
            fingerprint: primary.fingerprint,
            dualSnapshot: all,
        };
    }

    const provider = providerOverride || getProvider();
    if (!provider?.getBalance) {
        return { ok: false, error: 'no_balance_api' };
    }
    const raw = await provider.getBalance();
    if (isProviderErrorResponse(raw)) {
        return { ok: false, error: normalizeProviderError(raw) };
    }
    const balance = parseBalanceValue(raw);
    if (!Number.isFinite(balance)) {
        return { ok: false, error: 'balance_invalid', raw };
    }
    const currency = raw.currency || 'BRL';
    const classified = classifyBalance(balance);
    return {
        ok: true,
        balance,
        currency,
        level: classified.level,
        provider: provider.name || SmmConfig.defaultProvider,
        fingerprint: provider.keyFingerprint?.() || '—',
    };
}

function buildBalanceStatusHtml(snapshot, opts = {}) {
    if (snapshot.dualSnapshot?.length) {
        const lines = snapshot.dualSnapshot.map((row) => {
            const emoji = row.ok ? levelEmoji(classifyBalance(row.balance).level) : '⚪';
            const amount = row.ok
                ? `<b>${formatMoney(row.balance)}</b> ${row.currency || 'BRL'}`
                : `<i>${String(row.error || 'indisponível').slice(0, 80)}</i>`;
            return `${emoji} [${row.label}] ${amount} · key ${row.fingerprint}`;
        });
        let body =
            `💰 <b>Saldo Hanork SMM — dual provider</b>\n\n` +
            `${lines.join('\n')}\n\n` +
            `⚠️ Aviso: &lt; ${formatMoney(getWarnThreshold())}\n` +
            `🔴 Crítico: &lt; ${formatMoney(getCriticalThreshold())}\n`;
        if (opts.orderRef) body += `\n📋 Pedido bloqueado: <b>${opts.orderRef}</b>\n`;
        if (opts.detail) body += `⚙️ <i>${String(opts.detail).slice(0, 160)}</i>\n`;
        return body;
    }

    const { balance, currency, level } = snapshot;
    const emoji = levelEmoji(level);
    const label = levelLabel(level);
    const warn = getWarnThreshold();
    const crit = getCriticalThreshold();
    const rechargeUrl = getRechargeUrl();

    let body =
        `${emoji} <b>Saldo Hanork SMM — ${label}</b>\n\n` +
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
            `\n<b>Pedidos SMM podem falhar agora.</b>\n` +
            `Recarregue no painel (PIX, cartão ou cripto).\n` +
            `🔗 <a href="${rechargeUrl}">Abrir painel para recarregar</a>`;
    } else if (level === LEVEL.WARNING) {
        body +=
            `\n<i>Saldo suficiente por pouco — considere recarregar antes do tráfego.</i>\n` +
            `🔗 <a href="${rechargeUrl}">Recarregar no painel</a>`;
    } else if (opts.showOkHint) {
        body += `\n<i>Saldo confortável para operação.</i>`;
    }

    return body;
}

function adminBalanceKeyboard() {
    const rechargeUrl = getRechargeUrl();
    return Markup.inlineKeyboard([
        [{ text: '💳 Recarregar saldo', url: rechargeUrl }],
        [
            { text: '🔄 Atualizar saldo', callback_data: 'smm:bal:refresh' },
            { text: '📊 Stats SMM', callback_data: 'smm:bal:stats' },
        ],
        [{ text: '📱 Saldo Virtuo SMS', callback_data: 'virtuo:bal:refresh' }],
    ]);
}

function shouldNotifyMonitor(level, balance) {
    return SBM.shouldNotifyMonitor(STATE_KEY, level, balance, monitorNotifyConfig());
}

async function sendBalanceAlertToAdmins(bot, html, keyboard = null) {
    return SBM.sendBalanceAlertToAdmins(bot, html, keyboard);
}

async function notifyLowBalanceIfNeeded(bot, snapshot, opts = {}) {
    const decision = shouldNotifyMonitor(snapshot.level, snapshot.balance);
    if (!decision.notify) {
        return { notified: false, skipped: decision.kind || 'cooldown' };
    }

    const { fetchUnifiedSupplierSnapshot, buildAllSuppliersHtml } = require('../../../services/unifiedSupplierBalance');
    const unified = await fetchUnifiedSupplierSnapshot();
    const html = buildAllSuppliersHtml(unified.rows, {
        showOkHint: decision.kind === 'recovery',
        orderRef: opts.orderRef,
        detail: opts.detail,
    });
    const keyboard = adminBalanceKeyboard();

    if (decision.kind === 'recovery') {
        const recoveryHtml =
            `🟢 <b>Saldo Hanork SMM recuperado</b>\n\n` +
            `💰 Atual: <b>${formatMoney(snapshot.balance)}</b> ${snapshot.currency}\n` +
            `<i>Acima do limite de aviso (${formatMoney(getWarnThreshold())}).</i>`;
        await sendBalanceAlertToAdmins(bot, recoveryHtml, keyboard);
    } else {
        await sendBalanceAlertToAdmins(bot, html, keyboard);
    }

    return { notified: true, kind: decision.kind, level: snapshot.level };
}

async function notifyOrderBlockedForBalance(bot, { hanorkOrderId, balance, required, smmOrder }) {
    const snapshot = {
        balance: Number(balance),
        currency: 'BRL',
        level: classifyBalance(balance).level,
        provider: SmmConfig.defaultProvider,
    };
    const ref = hanorkOrderId ? `#${String(hanorkOrderId).slice(-8)}` : smmOrder?.id ? `SMM #${smmOrder.id}` : '—';
    const detail = `necessário ${formatMoney(required)} · disponível ${formatMoney(balance)}`;

    Object.assign(SBM.getState(STATE_KEY), {
        level: snapshot.level,
        notifiedAt: Date.now(),
        lastBalance: snapshot.balance,
    });

    const html = buildBalanceStatusHtml(snapshot, { orderRef: ref, detail });
    await sendBalanceAlertToAdmins(bot, html, adminBalanceKeyboard());
    return { notified: true };
}

async function runBalanceMonitorCycle(bot) {
    if (!isMonitorEnabled()) {
        return { skipped: true, reason: 'disabled' };
    }
    const snapshot = await fetchProviderBalance();
    if (!snapshot.ok) {
        logger.warn('[SMM:balance] consulta falhou', { detail: snapshot.error });
        return { ok: false, error: snapshot.error };
    }
    const result = await notifyLowBalanceIfNeeded(bot, snapshot);
    return { ok: true, balance: snapshot.balance, level: snapshot.level, ...result };
}

/** Para testes — reset dedup */
function _resetMonitorState() {
    SBM.resetState(STATE_KEY);
}

module.exports = {
    LEVEL,
    isMonitorEnabled,
    getWarnThreshold,
    getCriticalThreshold,
    getRechargeUrl,
    classifyBalance,
    fetchProviderBalance,
    buildBalanceStatusHtml,
    adminBalanceKeyboard,
    shouldNotifyMonitor,
    sendBalanceAlertToAdmins,
    notifyLowBalanceIfNeeded,
    notifyOrderBlockedForBalance,
    runBalanceMonitorCycle,
    _resetMonitorState,
};
