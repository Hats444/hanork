'use strict';

const ContextLogger = require('./ContextLogger');
const IntentRegistry = require('./IntentRegistry');
const { INTENT_TYPES } = require('./IntentTypes');

/**
 * Ações seguras apenas: persistir evento, memória, log — nunca checkout/delivery/PAID.
 */
class ActionRouter {
    constructor({ eventStore, memory }) {
        this._events = eventStore;
        this._memory = memory;
    }

    async route(parsed, scored, meta = {}) {
        const def = IntentRegistry.get(parsed.type);
        if (!def || parsed.type === INTENT_TYPES.UNKNOWN) {
            return { ok: false, reason: 'no_handler' };
        }

        const event = {
            tenant_id: meta.tenantId,
            operator_id: meta.operatorId,
            intent: parsed.type,
            confidence: scored.confidence,
            action: scored.action,
            entities: parsed.entities,
            raw: parsed.raw,
            context_reference: parsed.context_reference,
            source: parsed.source,
            correlation_id: meta.correlationId || null,
        };

        if (scored.action === 'ignore') {
            ContextLogger.ignored({ intent: parsed.type, confidence: scored.confidence });
            return { ok: true, ignored: true };
        }

        const saved = this._events.save(meta.tenantId, event);
        this._memory.updateFromParse(meta.tenantId, meta.operatorId, parsed);

        ContextLogger.actionExecuted({
            intent: parsed.type,
            confidence: scored.confidence,
            action: scored.action,
            eventId: saved.id,
        });

        let suggestion = null;
        if (scored.action === 'suggest' && typeof def.buildSuggestion === 'function') {
            suggestion = def.buildSuggestion(parsed);
        } else if (scored.action === 'execute' && typeof def.buildSuggestion === 'function') {
            suggestion = def.buildSuggestion(parsed);
        }

        return {
            ok: true,
            event: saved,
            suggestReply: suggestion,
            notify: scored.action !== 'ignore',
        };
    }
}

module.exports = ActionRouter;
