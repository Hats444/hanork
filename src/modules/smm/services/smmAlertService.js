'use strict';

const logger = require('../../../config/logger');
const { formatMoney } = require('../utils/smmTextFormat');
const {
    fulfillFailureNoticeKeyboard,
    orderIssueNoticeKeyboard,
} = require('../keyboards/smmNoticeKeyboards');

const REASON_LABELS = {
    insufficient_provider_balance: 'Saldo insuficiente na operação',
    no_healthy_candidates: 'Serviço indisponível (saúde)',
    provider_rejected: 'Pedido rejeitado na execução',
    all_providers_failed: 'API do fornecedor indisponível',
    fulfill_job_crash: 'Erro técnico ao processar',
    stuck_fulfill_timeout: 'Pedido não enviado ao fornecedor',
    no_viable_service: 'Nenhum serviço viável na família',
    no_provider: 'Provider não configurado',
    service_not_found: 'Serviço não encontrado no catálogo',
    order_failed: 'Pedido falhou no fornecedor',
    order_canceled: 'Pedido cancelado no fornecedor',
    refill_rejected: 'Reposição não aprovada',
};

const DEDUP_MS = 10 * 60 * 1000;
const recentAlerts = new Map();

function isEnabled() {
    const v = String(process.env.SMM_ALERT_ADMIN ?? '1').toLowerCase();
    return v !== '0' && v !== 'false';
}

function orderRef(hanorkOrderId, smmOrder) {
    if (hanorkOrderId) return `#${String(hanorkOrderId).slice(-8)}`;
    if (smmOrder?.id) return `SMM #${smmOrder.id}`;
    return 'n/d';
}

function supportTicketHint(ref) {
    return (
        `\n\n<b>Precisa de ajuda?</b>\n` +
        `Toque em <b>Abrir ticket</b> abaixo ou envie <code>/suporte</code>.\n` +
        `<i>Cite o pedido <b>${ref}</b> e descreva o que aconteceu. Nossa equipe responde no PV.</i>`
    );
}

function buildAdminAlertHtml({ reason, hanorkOrderId, smmOrder, service, detail }) {
    const ref = orderRef(hanorkOrderId, smmOrder);
    const label = REASON_LABELS[reason] || reason || 'Erro SMM';
    const uid = smmOrder?.telegram_id ? `<code>${smmOrder.telegram_id}</code>` : '—';
    const svc = service?.name ? service.name.slice(0, 80) : service?.subcategory || '—';
    const qty = smmOrder?.quantity != null ? Number(smmOrder.quantity).toLocaleString('pt-BR') : '—';
    const total = smmOrder?.sale_price != null ? formatMoney(smmOrder.sale_price) : '—';
    const link = smmOrder?.link ? smmOrder.link.slice(0, 120) : '—';
    const detailLine = detail ? `\n⚙️ <i>${String(detail).slice(0, 200)}</i>` : '';

    return (
        `🚨 <b>SMM — ${label}</b>\n\n` +
        `📋 Pedido: <b>${ref}</b>\n` +
        `👤 Cliente: ${uid}\n` +
        `📦 ${svc}\n` +
        `📊 Qtd: <b>${qty}</b> · 💰 <b>${total}</b>\n` +
        `🔗 ${link}` +
        detailLine +
        `\n\n<i>Ação: verificar fornecedor, saldo ou reenviar com smm-retry-fulfill.</i>`
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
    const notifier = global.adminActivityNotifier;
    if (!notifier?.enabled || !notifier.adminIds?.length) {
        logger.warn('[SMM:alert] adminActivityNotifier indisponível');
        return false;
    }

    const { reason, hanorkOrderId, smmOrder, service, detail } = opts;
    if (shouldSkipDedup(hanorkOrderId, reason)) {
        logger.debug('[SMM:alert] dedup admin', { hanorkOrderId, reason });
        return false;
    }

    const html = buildAdminAlertHtml({ reason, hanorkOrderId, smmOrder, service, detail });
    let sent = 0;
    for (const adminId of notifier.adminIds) {
        try {
            const ok = await notifier.sendToAdmin(adminId, html);
            if (ok) sent++;
        } catch (e) {
            logger.warn('[SMM:alert] falha PV admin', { adminId, detail: e.message });
        }
    }

    if (sent > 0) {
        logger.info('[SMM:alert] admin notificado', {
            reason,
            hanorkOrderId,
            smmOrderId: smmOrder?.id,
            admins: sent,
        });
    }
    return sent > 0;
}

function buildUserFailureMessage({ reason, hanorkOrderId, smmOrder }) {
    const ref = orderRef(hanorkOrderId, smmOrder);
    const walletHint =
        `\n\n<i>O valor pago será creditado na sua <b>Carteira Hanork</b> — use no próximo checkout (produtos, SMM ou SMS).</i>`;

    const base =
        reason === 'insufficient_provider_balance'
            ? `<b>Pagamento confirmado</b>, mas estamos com alta demanda no momento.\n\nPedido: <b>${ref}</b>`
            : reason === 'all_providers_failed' || reason === 'provider_rejected'
                ? `<b>Pagamento confirmado</b>, mas a API do fornecedor não aceitou o pedido agora.\n\nPedido: <b>${ref}</b>`
                : reason === 'fulfill_job_crash' || reason === 'stuck_fulfill_timeout'
                    ? `<b>Pagamento confirmado</b>, mas houve um problema técnico ao enviar seu pedido SMM.\n\nPedido: <b>${ref}</b>`
                    : reason === 'no_healthy_candidates' || reason === 'no_viable_service'
                        ? `<b>Pagamento confirmado</b>, mas o serviço está temporariamente indisponível.\n\nPedido: <b>${ref}</b>`
                        : `<b>Houve um problema</b> com seu pedido SMM.\n\nPedido: <b>${ref}</b>`;

    const footer =
        reason === 'insufficient_provider_balance'
            ? `\n\n<i>Nossa equipe já foi avisada. Se o crédito não aparecer em instantes, abra um ticket.</i>`
            : walletHint;

    return base + footer + supportTicketHint(ref);
}

function buildUserTerminalMessage(order, status) {
    const ref = orderRef(order?.hanork_order_id, order);
    const qty = Number(order?.quantity || 0).toLocaleString('pt-BR');
    const total = formatMoney(order?.sale_price);

    if (status === 'failed') {
        return (
            `<b>Pedido SMM com falha</b>\n\n` +
            `${ref}\n` +
            `${qty} un. · ${total}\n\n` +
            `<i>O fornecedor não concluiu a entrega. O valor será creditado na sua carteira Hanork.</i>` +
            supportTicketHint(ref)
        );
    }
    if (status === 'canceled') {
        return (
            `<b>Pedido SMM cancelado</b>\n\n` +
            `${ref}\n\n` +
            `<i>O pedido foi cancelado no fornecedor. O valor volta como saldo na carteira Hanork.</i>` +
            supportTicketHint(ref)
        );
    }
    return null;
}

function keyboardForIssue(smmOrderId, serviceId = null) {
    return orderIssueNoticeKeyboard(smmOrderId, serviceId);
}

async function handleFulfillFailure({
    reason,
    hanorkOrderId,
    smmOrder,
    service,
    detail,
}) {
    if (reason !== 'insufficient_provider_balance') {
        await notifyAdminsOrderIssue({
            reason,
            hanorkOrderId,
            smmOrder,
            service,
            detail,
        });
    }
    return {
        text: buildUserFailureMessage({ reason, hanorkOrderId, smmOrder }),
        keyboard: keyboardForIssue(smmOrder?.id, service?.id),
    };
}

async function handleTerminalStatus(order, status) {
    if (status === 'failed') {
        await notifyAdminsOrderIssue({
            reason: 'order_failed',
            hanorkOrderId: order.hanork_order_id,
            smmOrder: order,
            detail: `status=${status}`,
        });
    }
    return {
        text: buildUserTerminalMessage(order, status),
        keyboard: order?.id ? orderIssueNoticeKeyboard(order.id) : null,
    };
}

module.exports = {
    REASON_LABELS,
    isEnabled,
    supportTicketHint,
    buildAdminAlertHtml,
    notifyAdminsOrderIssue,
    buildUserFailureMessage,
    buildUserTerminalMessage,
    handleFulfillFailure,
    handleTerminalStatus,
    keyboardForIssue,
};
