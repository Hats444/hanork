'use strict';

const { INTENT_TYPES } = require('../IntentTypes');

module.exports = {
    type: INTENT_TYPES.REMINDER_CREATION,
    boost(entities) {
        return entities.date || entities.time ? 0.05 : 0;
    },
    buildSuggestion(parsed) {
        const when = parsed.entities.date?.word || parsed.entities.date?.relative || 'em breve';
        return `⏰ <b>Lembrete sugerido</b>\n${when}\n\n<i>Confirme no painel ou ajuste a data.</i>`;
    },
};
