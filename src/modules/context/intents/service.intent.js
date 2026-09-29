'use strict';

const { INTENT_TYPES } = require('../IntentTypes');

module.exports = {
    type: INTENT_TYPES.SERVICE_REGISTER,
    requiredEntities: [],
    boost(entities) {
        let b = 0;
        if (entities.amount != null) b += 0.05;
        if (entities.service) b += 0.04;
        if (entities.client) b += 0.03;
        return b;
    },
    buildSuggestion(parsed) {
        const svc = parsed.entities.service || 'serviço';
        const amt = parsed.entities.amount != null ? ` — R$ ${parsed.entities.amount}` : '';
        return `🔧 <b>Serviço anotado</b>\n${svc}${amt}\n\n<i>Registro operacional — não altera pedidos do catálogo.</i>`;
    },
};
