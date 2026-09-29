'use strict';

const EntityExtractor = require('./EntityExtractor');
const IntentClassifier = require('./IntentClassifier');
const { INTENT_TYPES } = require('./IntentTypes');

/**
 * @param {string} raw
 * @param {{ tenantId, operatorId, source, memory }} meta
 */
function parse(raw, meta = {}) {
    const text = String(raw || '').trim();
    const entities = EntityExtractor.extractAll(text);

    if (meta.memory && meta.resolveClient) {
        entities.client = meta.resolveClient(entities, text) || entities.client;
    }

    const classified = IntentClassifier.classify(text, entities);
    const type = classified.type === INTENT_TYPES.UNKNOWN ? null : classified.type;

    return {
        type: type || INTENT_TYPES.UNKNOWN,
        confidence: classified.score,
        entities: {
            client: entities.client || null,
            amount: entities.amount,
            amounts: entities.amounts,
            method: entities.method,
            date: entities.date,
            time: entities.time,
            service: entities.service,
            location: entities.location,
        },
        raw: text,
        timestamp: new Date().toISOString(),
        tenant_id: meta.tenantId ?? null,
        operator_id: meta.operatorId ?? null,
        source: meta.source || 'telegram',
        context_reference: !!entities.pronounRef,
    };
}

module.exports = { parse };
