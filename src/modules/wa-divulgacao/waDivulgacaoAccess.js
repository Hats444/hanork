'use strict';

const WaDivulgacaoConfig = require('./waDivulgacaoConfig');

function isWaDivulgacaoEnabled() {
    return WaDivulgacaoConfig.enabled;
}

function isWaDivulgacaoOperator(telegramId) {
    try {
        const Operator = require('./waDivulgacaoOperatorService');
        return Boolean(Operator.isOperator?.(telegramId));
    } catch {
        return false;
    }
}

/** Admin/operador ainda acessam com módulo desligado para usuários. */
function canAccessWaDivulgacao(ctx, isAdminFn) {
    if (WaDivulgacaoConfig.enabled) return true;
    const uid = ctx?.from?.id;
    if (uid && isAdminFn?.(uid)) return true;
    if (uid && isWaDivulgacaoOperator(uid)) return true;
    return false;
}

/** Botão Planos Premium / Hanork Div no menu principal. */
function isPremiumMenuVisible() {
    if (WaDivulgacaoConfig.enabled) return true;
    try {
        const CustomerSubscriptionService = require('../subscription/CustomerSubscriptionService');
        return (CustomerSubscriptionService.listSubscriptionProducts() || []).length > 0;
    } catch {
        return false;
    }
}

module.exports = {
    isWaDivulgacaoEnabled,
    canAccessWaDivulgacao,
    isPremiumMenuVisible,
    isWaDivulgacaoOperator,
};
