'use strict';

const { serviceDisplayLabel } = require('../services/displayLabelService');
const { formatQuantityDisplay } = require('../constants/serviceTypes');

/** Mantido para compatibilidade; ícones desativados (UI profissional). */
const PLATFORM_ICONS = {};

function truncate(str, max = 38) {
    const s = String(str || '').trim();
    if (s.length <= max) return s;
    return `${s.slice(0, max - 1)}…`;
}

function formatMoney(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 'R$ 0,00';
    return `R$ ${n.toFixed(2).replace('.', ',')}`;
}

function formatServiceDetail(svc) {
    const { buildServiceDescription } = require('../services/serviceDescriptionService');
    return buildServiceDescription(svc);
}

function formatQuote(svc, quantity, saleTotal, opts = {}) {
    const payHint =
        opts.step === 'payment'
            ? ''
            : `\n\n<i>Na próxima tela: <b>PIX</b> ou <b>Cartão</b> (Mercado Pago).</i>`;
    const title = serviceDisplayLabel(svc, { max: 80 });
    const qtyLabel = svc ? formatQuantityDisplay(svc, quantity) : String(quantity);
    return (
        `<b>Resumo do pedido</b>\n\n` +
        `${title}\n` +
        `Quantidade: <b>${qtyLabel}</b>\n` +
        `Total: <b>${formatMoney(saleTotal)}</b>` +
        payHint
    );
}

const STATUS_LABELS = {
    awaiting_payment: 'Aguardando pagamento',
    paid: 'Pago',
    submitted: 'Enviado',
    processing: 'Processando',
    partial: 'Parcial',
    completed: 'Concluído',
    canceled: 'Cancelado',
    failed: 'Falhou',
    refill_pending: 'Reposição',
    pending: 'Pendente',
};

function formatOrderStatus(status) {
    return STATUS_LABELS[status] || status;
}

function formatOrderLine(order, serviceName, service) {
    const ref = order.hanork_order_id ? `#${String(order.hanork_order_id).slice(-8)}` : `#${order.id}`;
    const name = truncate(serviceName || 'Serviço', 40);
    const qtyText = service
        ? formatQuantityDisplay(service, order.quantity)
        : `${Number(order.quantity).toLocaleString('pt-BR')} un.`;
    return `${formatOrderStatus(order.status)} · ${ref}\n<i>${name}</i> · ${qtyText}`;
}

module.exports = {
    PLATFORM_ICONS,
    truncate,
    formatMoney,
    formatServiceDetail,
    formatQuote,
    formatOrderStatus,
    formatOrderLine,
    STATUS_LABELS,
};
