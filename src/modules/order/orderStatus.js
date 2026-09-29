'use strict';

/** Status canônico de pedido cancelado pelo usuário */
const ORDER_FAILED = 'FAILED';

/** Legado — migrado para FAILED na startup */
const LEGACY_CANCELLED = 'CANCELLED';

const CANCELLED_STATUSES = [ORDER_FAILED, LEGACY_CANCELLED];

const STATUS_LABELS = {
  CREATED: '🆕 Criado',
  WAITING_PAYMENT: '⏳ Aguardando pagamento',
  PAID: '✅ Pago',
  DELIVERING: '📦 Entregando',
  DELIVERED: '✅ Entregue',
  FAILED: '❌ Cancelado',
  CANCELLED: '❌ Cancelado',
  PAYMENT_ERROR: '⚠️ Erro pagamento',
};

function isCancelled(status) {
  return CANCELLED_STATUSES.includes(status);
}

function isPaidOrDelivering(status) {
  return status === 'PAID' || status === 'DELIVERING';
}

function label(status) {
  return STATUS_LABELS[status] || status;
}

module.exports = {
  ORDER_FAILED,
  LEGACY_CANCELLED,
  CANCELLED_STATUSES,
  STATUS_LABELS,
  isCancelled,
  isPaidOrDelivering,
  label,
};
