'use strict';

const { INTENT_TYPES } = require('./IntentTypes');
const { normalizeText } = require('./EntityExtractor');

const PATTERNS = [
    {
        type: INTENT_TYPES.PAYMENT_CONFIRMATION,
        weight: 1,
        test: (t) =>
            /\b(pagou|pago|pagamento|transferiu|depositou|recebi|entrou)\b/.test(t) &&
            (/\d/.test(t) || /\bpix\b/.test(t)),
    },
    {
        type: INTENT_TYPES.SERVICE_REGISTER,
        weight: 0.95,
        test: (t) =>
            /\b(ficou|orcamento|orçamento|servico|serviço|troca|instal|consert|repar)\b/.test(t) &&
            /\d/.test(t),
    },
    {
        type: INTENT_TYPES.APPOINTMENT_SCHEDULE,
        weight: 0.9,
        test: (t) =>
            (/\b(amanha|amanhã|hoje|segunda|terca|terça|quarta|quinta|sexta)\b/.test(t) ||
                /\b\d{1,2}[:h]\d{0,2}\b/.test(t)) &&
            /\b(casa|visita|agendar|marcar|horario|horário)\b/.test(t),
    },
    {
        type: INTENT_TYPES.DEBT_TRACKING,
        weight: 0.88,
        test: (t) =>
            /\b(devendo|divida|dívida|falta pagar|vai pagar|pagar sexta|pagar segunda)\b/.test(t),
    },
    {
        type: INTENT_TYPES.REMINDER_CREATION,
        weight: 0.85,
        test: (t) => /\b(lembre|lembrar|me avisa|me avise|na sexta|na segunda)\b/.test(t),
    },
    {
        type: INTENT_TYPES.NEGOTIATION,
        weight: 0.82,
        test: (t) => /\b(desconto|negoci|parcel|a vista|à vista|abatimento)\b/.test(t),
    },
];

function classify(text, entities = {}) {
    const t = normalizeText(text);
    let best = { type: INTENT_TYPES.UNKNOWN, score: 0 };

    for (const p of PATTERNS) {
        if (!p.test(t)) continue;
        let score = p.weight;
        if (p.type === INTENT_TYPES.PAYMENT_CONFIRMATION && entities.amount) score += 0.05;
        if (p.type === INTENT_TYPES.SERVICE_REGISTER && entities.service) score += 0.05;
        if (score > best.score) best = { type: p.type, score: Math.min(score, 0.99) };
    }

    if (entities.pronounRef && best.type === INTENT_TYPES.DEBT_TRACKING) {
        best.score = Math.min(best.score + 0.08, 0.95);
    }

    return best;
}

module.exports = { classify, PATTERNS };
