'use strict';

const { INTENT_TYPES } = require('../IntentTypes');

module.exports = {
    type: INTENT_TYPES.DEBT_TRACKING,
    boost(entities) {
        return entities.client ? 0.05 : 0;
    },
    buildSuggestion(parsed) {
        const who = parsed.entities.client || 'cliente';
        return `📋 <b>Dívida / promessa de pagamento</b>\n${who}\n\n<i>Apenas registro operacional.</i>`;
    },
};
