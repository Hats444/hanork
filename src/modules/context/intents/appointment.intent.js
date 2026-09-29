'use strict';

const { INTENT_TYPES } = require('../IntentTypes');

module.exports = {
    type: INTENT_TYPES.APPOINTMENT_SCHEDULE,
    boost(entities) {
        let b = 0;
        if (entities.date) b += 0.04;
        if (entities.time) b += 0.04;
        if (entities.location || entities.client) b += 0.03;
        return b;
    },
    buildSuggestion(parsed) {
        const loc = parsed.entities.location || parsed.entities.client || 'local';
        const t = parsed.entities.time
            ? `${parsed.entities.time.hour}:${String(parsed.entities.time.minute).padStart(2, '0')}`
            : 'horário a definir';
        return `📅 <b>Compromisso sugerido</b>\n${loc} — ${t}\n\n<i>Confirme manualmente com o cliente.</i>`;
    },
};
