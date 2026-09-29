'use strict';

const { INTENT_TYPES } = require('./IntentTypes');

const MAX_TEXT = 2000;
const MAX_AMOUNT = 10_000_000;

function validate(parsed, ctx = {}) {
    const errors = [];
    if (!parsed?.raw || parsed.raw.length > MAX_TEXT) {
        errors.push('texto inválido ou longo demais');
    }
    if (!ctx.operatorId) errors.push('operador ausente');
    if (parsed.entities?.amount != null) {
        const a = parsed.entities.amount;
        if (!Number.isFinite(a) || a <= 0 || a > MAX_AMOUNT) errors.push('valor inválido');
    }
    if (parsed.type === INTENT_TYPES.UNKNOWN) errors.push('intenção desconhecida');

    const allowed = ctx.allowedIntents;
    if (allowed && parsed.type && !allowed.includes(parsed.type)) {
        errors.push('intenção não permitida');
    }

    return { ok: errors.length === 0, errors };
}

module.exports = { validate };
