'use strict';

const { familyDisplayLabel } = require('../services/familyService');

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
    const title = svc?.service_family
        ? familyDisplayLabel(svc.service_family, svc.subcategory)
        : truncate(svc?.name || 'Serviço', 80);
    const qtyLabel =
        String(svc?.service_type || 'Default') === 'Package' && Number(quantity) === 1
            ? '1 pacote'
            : `<b>${quantity}</b>`;
    return (
        `<b>Resumo do pedido</b>\n\n` +
        `${title}\n` +
        `Quantidade: ${qtyLabel}\n` +
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

function formatOrderLine(order, serviceName) {
    const ref = order.hanork_order_id ? `#${String(order.hanork_order_id).slice(-8)}` : `#${order.id}`;
    const name = truncate(serviceName || 'Serviço', 40);
    return `${formatOrderStatus(order.status)} · ${ref}\n<i>${name}</i> · ${Number(order.quantity).toLocaleString('pt-BR')} un.`;
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
