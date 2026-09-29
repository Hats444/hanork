'use strict';

const { ORDER_STATUS } = require('../constants/orderStatuses');

function serviceFlag(value) {
    return value === 1 || value === true || value === '1';
}

const CANCELABLE_STATUSES = new Set([
    ORDER_STATUS.SUBMITTED,
    ORDER_STATUS.PROCESSING,
    ORDER_STATUS.PARTIAL,
]);

function canRequestRefill(smmOrder, service) {
    if (!smmOrder) return { ok: false, error: 'order_not_found' };
    if (!serviceFlag(service?.refill)) return { ok: false, error: 'refill_not_allowed' };
    if (smmOrder.status === ORDER_STATUS.REFILL_PENDING) {
        return { ok: false, error: 'refill_in_progress' };
    }
    if (smmOrder.status !== ORDER_STATUS.COMPLETED) {
        return { ok: false, error: 'order_not_completed' };
    }
    if (!smmOrder.provider_order_id) return { ok: false, error: 'no_provider_order' };
    return { ok: true };
}

function canRequestCancel(smmOrder, service) {
    if (!smmOrder) return { ok: false, error: 'order_not_found' };
    if (!serviceFlag(service?.cancel)) return { ok: false, error: 'cancel_not_allowed' };
    if (!CANCELABLE_STATUSES.has(smmOrder.status)) {
        return { ok: false, error: 'status_not_cancelable' };
    }
    if (!smmOrder.provider_order_id) return { ok: false, error: 'no_provider_order' };
    return { ok: true };
}

function checkoutErrorMessage(code) {
    const map = {
        link_invalid: 'Envie um link válido (https://…)',
        link_platform_mismatch: 'O link não corresponde à plataforma do serviço.',
        target_too_short: 'Informe os dados do pedido (mínimo 3 caracteres).',
        target_too_long: 'Texto muito longo (máx. 500 caracteres).',
        comments_required: 'Envie pelo menos um comentário (um por linha).',
        comments_count_mismatch: 'A quantidade deve ser igual ao número de linhas de comentário.',
        quantity_invalid: 'Quantidade inválida.',
        quantity_below_min: 'Quantidade abaixo do mínimo.',
        quantity_above_max: 'Quantidade acima do máximo.',
        duplicate_order: 'Pedido idêntico recente. Aguarde ou altere link/quantidade.',
        payment_below_minimum: 'Valor abaixo do mínimo do Mercado Pago (R$ 0,50). Aumente a quantidade.',
        rate_limited: 'Muitas ações em pouco tempo. Aguarde um momento.',
    };
    return map[code] || 'Não foi possível continuar.';
}

function actionErrorMessage(code) {
    const map = {
        order_not_found: 'Pedido não encontrado.',
        refill_not_allowed: 'Este serviço não permite reposição.',
        refill_in_progress: 'Reposição já em andamento.',
        order_not_completed: 'Reposição só após conclusão do pedido.',
        cancel_not_allowed: 'Este serviço não permite cancelamento.',
        status_not_cancelable: 'Pedido não pode ser cancelado neste status.',
        no_provider_order: 'Pedido ainda não enviado ao fornecedor.',
        provider_rejected: 'Fornecedor rejeitou a solicitação.',
        not_owner: 'Este pedido não é seu.',
    };
    return map[code] || 'Operação não disponível.';
}

module.exports = {
    serviceFlag,
    CANCELABLE_STATUSES,
    canRequestRefill,
    canRequestCancel,
    checkoutErrorMessage,
    actionErrorMessage,
};
