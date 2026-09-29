'use strict';

const logger = require('../../../config/logger');
const { formatMoney } = require('../utils/virtuoTextFormat');
const { CB } = require('../utils/virtuoCallbackData');
const L = require('../utils/virtuoLabels');
const { escapeTelegramHtml } = require('../../../telegram/htmlEscape');

const REASON_LABELS = {
    insufficient_provider_balance: 'Saldo insuficiente na Virtuo',
    balance_check_failed: 'Falha ao consultar saldo Virtuo',
    out_of_stock: 'Sem números disponíveis',
    provider_rejected: 'Ativação rejeitada pela Virtuo',
    service_not_found: 'Serviço não encontrado no catálogo',
    activation_failed: 'Falha na ativação do número',
    invalid_activation_response: 'Resposta inválida da Virtuo',
    order_failed: 'Pedido SMS falhou',
};

const DEDUP_MS = 10 * 60 * 1000;
const recentAlerts = new Map();

function isEnabled() {
    const v = String(process.env.VIRTUO_ALERT_ADMIN ?? process.env.SMM_ALERT_ADMIN ?? '1').toLowerCase();
    return v !== '0' && v !== 'false';
}

function orderRef(hanorkOrderId, virtuoOrder) {
    if (hanorkOrderId) return `#${String(hanorkOrderId).slice(-8)}`;
    if (virtuoOrder?.id) return `Virtuo #${virtuoOrder.id}`;
    return 'n/d';
}

function supportTicketHint(ref) {
    return (
        `\n\n<b>Precisa de ajuda?</b>\n` +
        `Envie <code>/suporte</code> citando o pedido <b>${ref}</b>.`
    );
}

function buildAdminAlertHtml({ reason, hanorkOrderId, virtuoOrder, detail }) {
    const ref = orderRef(hanorkOrderId, virtuoOrder);
    const label = REASON_LABELS[reason] || reason || 'Erro Virtuo SMS';
    const uid = virtuoOrder?.telegram_id ? `<code>${virtuoOrder.telegram_id}</code>` : '—';
    const svc = virtuoOrder?.service_name
        ? escapeTelegramHtml(String(virtuoOrder.service_name).slice(0, 80))
        : '—';
    const country = virtuoOrder?.country_name ? escapeTelegramHtml(virtuoOrder.country_name) : '—';
    const total = virtuoOrder?.sale_price != null ? formatMoney(virtuoOrder.sale_price) : '—';
    const detailLine = detail ? `\n⚙️ <i>${escapeTelegramHtml(String(detail).slice(0, 200))}</i>` : '';

    return (
        `🚨 <b>Virtuo SMS — ${label}</b>\n\n` +
        `📋 Pedido: <b>${ref}</b>\n` +
        `👤 Cliente: ${uid}\n` +
        `📱 ${svc} · ${country}\n` +
        `💰 <b>${total}</b>` +
        detailLine +
        `\n\n<i>Ação: verificar saldo Virtuo, catálogo ou reprocessar pedido.</i>`
    );
}

function shouldSkipDedup(hanorkOrderId, reason) {
    const key = `${hanorkOrderId || 'na'}:${reason || 'unknown'}`;
    const now = Date.now();
    const prev = recentAlerts.get(key);
    if (prev && now - prev < DEDUP_MS) return true;
    recentAlerts.set(key, now);
    if (recentAlerts.size > 500) {
        for (const [k, t] of recentAlerts) {
            if (now - t > DEDUP_MS) recentAlerts.delete(k);
        }
    }
    return false;
}

async function notifyAdminsOrderIssue(opts = {}) {
    if (!isEnabled()) return false;

    const { reason, hanorkOrderId, virtuoOrder, detail } = opts;
    if (shouldSkipDedup(hanorkOrderId, reason)) {
        logger.debug('[Virtuo:alert] dedup admin', { hanorkOrderId, reason });
        return false;
    }

    const html = buildAdminAlertHtml({ reason, hanorkOrderId, virtuoOrder, detail });
    const notifier = global.adminActivityNotifier;
    let sent = 0;

    if (notifier?.enabled && notifier.adminIds?.length) {
        for (const adminId of notifier.adminIds) {
            try {
                const ok = await notifier.sendToAdmin(adminId, html);
                if (ok) sent++;
            } catch (e) {
                logger.warn('[Virtuo:alert] falha PV admin', { adminId, detail: e.message });
            }
        }
    }

    if (sent === 0) {
        const SBM = require('../../../services/supplierBalanceMonitor');
        const bot = global.botInstance;
        if (bot) {
            const r = await SBM.sendBalanceAlertToAdmins(bot, html);
            sent = r.sent || 0;
        }
    }

    if (sent > 0) {
        logger.info('[Virtuo:alert] admin notificado', {
            reason,
            hanorkOrderId,
            virtuoOrderId: virtuoOrder?.id,
            admins: sent,
        });
    }
    return sent > 0;
}

function buildUserFailureMessage({ reason, hanorkOrderId, virtuoOrder, detail, refundResult }) {
    const ref = orderRef(hanorkOrderId, virtuoOrder);
    const total = Number(virtuoOrder?.sale_price);
    const { refundUserLine } = require('./virtuoFailureRecoveryService');

    const base =
        reason === 'insufficient_provider_balance'
            ? `<b>Pagamento confirmado</b>, mas estamos com alta demanda no momento.\n\nPedido: <b>${ref}</b>`
            : reason === 'out_of_stock'
                ? `<b>Pagamento confirmado</b>, mas não há números disponíveis para este país agora.\n\nPedido: <b>${ref}</b>`
                : reason === 'order_failed'
                    ? `<b>O tempo para receber o SMS expirou.</b>\n\nPedido: <b>${ref}</b>`
                    : `<b>Pagamento confirmado</b>, mas houve falha ao reservar seu número.\n\nPedido: <b>${ref}</b>`;

    const refundLine = refundResult ? refundUserLine(refundResult, total) : '';
    const footer = refundLine
        ? ''
        : reason === 'insufficient_provider_balance'
            ? `\n\n<i>Nossa equipe já foi avisada e vai resolver o mais rápido possível.</i>`
            : `\n\n<i>Se precisar, abra um ticket. Levamos seu caso com prioridade.</i>`;

    const extra = detail && !refundLine ? `\n\n<i>${escapeTelegramHtml(String(detail).slice(0, 120))}</i>` : '';
    return base + extra + refundLine + footer + supportTicketHint(ref);
}

function failureKeyboard() {
    const OrderFailureCreditService = require('../../../services/OrderFailureCreditService');
    return OrderFailureCreditService.walletNotifyKeyboard().reply_markup;
}

async function handleFulfillFailure({ reason, hanorkOrderId, virtuoOrder, detail, bot, guard, refundResult }) {
    if (reason !== 'insufficient_provider_balance') {
        await notifyAdminsOrderIssue({ reason, hanorkOrderId, virtuoOrder, detail });
    } else if (guard?.balance != null && bot) {
        const VirtuoBalanceService = require('./virtuoBalanceService');
        await VirtuoBalanceService.notifyOrderBlockedForBalance(bot, {
            hanorkOrderId,
            balance: guard.balance,
            required: guard.required,
            virtuoOrder,
        });
        await notifyAdminsOrderIssue({
            reason,
            hanorkOrderId,
            virtuoOrder,
            detail: detail || `balance=${guard.balance} required=${guard.required}`,
        });
    }

    return {
        text: buildUserFailureMessage({ reason, hanorkOrderId, virtuoOrder, detail, refundResult }),
        keyboard: failureKeyboard(),
    };
}

module.exports = {
    REASON_LABELS,
    isEnabled,
    notifyAdminsOrderIssue,
    buildUserFailureMessage,
    handleFulfillFailure,
};
