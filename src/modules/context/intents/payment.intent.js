'use strict';

const { INTENT_TYPES } = require('../IntentTypes');

module.exports = {
    type: INTENT_TYPES.PAYMENT_CONFIRMATION,
    requiredEntities: [],
    boost(entities) {
        let b = 0;
        if (entities.amount != null) b += 0.06;
        if (entities.client) b += 0.05;
        if (entities.method) b += 0.03;
        return b;
    },
    buildSuggestion(parsed) {
        const { client, amount, method } = parsed.entities;
        const parts = [];
        if (client) parts.push(`cliente: <b>${client}</b>`);
        if (amount != null) parts.push(`valor: <b>R$ ${amount}</b>`);
        if (method) parts.push(`via: <b>${method}</b>`);
        return `💰 <b>Pagamento registrado (sugestão)</b>\n${parts.join(' · ')}\n\n<i>Não confirma pedido automaticamente — use o painel se necessário.</i>`;
    },
};
