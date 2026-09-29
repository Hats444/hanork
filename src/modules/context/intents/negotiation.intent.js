'use strict';

const { INTENT_TYPES } = require('../IntentTypes');

module.exports = {
    type: INTENT_TYPES.NEGOTIATION,
    boost() {
        return 0.02;
    },
    buildSuggestion() {
        return `🤝 <b>Negociação detectada</b>\n<i>Registre desconto/condição manualmente — sem alterar checkout.</i>`;
    },
};
