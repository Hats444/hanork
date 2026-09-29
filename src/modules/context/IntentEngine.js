'use strict';

const OperationalParser = require('./OperationalParser');
const ConfidenceScorer = require('./ConfidenceScorer');
const ValidationLayer = require('./ValidationLayer');
const DuplicateProtection = require('./DuplicateProtection');
const ContextMemory = require('./ContextMemory');
const ActionRouter = require('./ActionRouter');
const OperationalEventStore = require('./OperationalEventStore');
const SafeExecution = require('./SafeExecution');
const ContextLogger = require('./ContextLogger');
const IntentRegistry = require('./IntentRegistry');
const { INTENT_TYPES } = require('./IntentTypes');

class IntentEngine {
    constructor(deps = {}) {
        const stateManager = deps.stateManager;
        this._memory = new ContextMemory(stateManager);
        this._dup = new DuplicateProtection(stateManager);
        this._events = new OperationalEventStore(deps.dbRaw);
        this._router = new ActionRouter({ eventStore: this._events, memory: this._memory });
        this._getCorrelationId = deps.getCorrelationId || (() => null);
    }

    async process({ text, tenantId, operatorId, source = 'telegram' }) {
        if (!text || String(text).trim().length < 4) {
            return { ok: true, skipped: true, reason: 'short' };
        }

        const run = async () => {
            const mem = this._memory.get(tenantId, operatorId);
            const resolveClient = (entities) =>
                this._memory.resolveClient(tenantId, operatorId, entities, text);

            const parsed = OperationalParser.parse(text, {
                tenantId,
                operatorId,
                source,
                memory: mem,
                resolveClient,
            });

            const intentDef = IntentRegistry.get(parsed.type);
            let classifierScore = parsed.confidence;
            if (intentDef?.boost) {
                classifierScore = Math.min(
                    0.99,
                    classifierScore + intentDef.boost(parsed.entities)
                );
            }

            const scored = ConfidenceScorer.score({
                classifierScore,
                entities: parsed.entities,
                hasContextRef: parsed.context_reference,
            });
            parsed.confidence = scored.confidence;

            ContextLogger.intentDetected({
                intent: parsed.type,
                confidence: scored.confidence,
                action: scored.action,
                tenantId,
                operatorId,
            });
            ContextLogger.entitiesExtracted({ entities: parsed.entities });
            ContextLogger.confidenceScore({ confidence: scored.confidence, thresholds: scored.thresholds });

            if (parsed.type === INTENT_TYPES.UNKNOWN || scored.action === 'ignore') {
                ContextLogger.ignored({ reason: 'low_confidence', confidence: scored.confidence });
                return { ok: true, skipped: true, parsed, scored };
            }

            const validation = ValidationLayer.validate(parsed, { operatorId });
            if (!validation.ok) {
                ContextLogger.ignored({ reason: 'validation', errors: validation.errors });
                return { ok: true, skipped: true, validation };
            }

            if (this._dup.isDuplicate(tenantId, operatorId, text)) {
                ContextLogger.ignored({ reason: 'duplicate' });
                return { ok: true, skipped: true, duplicate: true };
            }

            const routed = await this._router.route(parsed, scored, {
                tenantId,
                operatorId,
                correlationId: this._getCorrelationId(),
            });

            return { ok: true, parsed, scored, routed };
        };

        const wrapped = await SafeExecution.run(run, { tenantId, operatorId });
        if (!wrapped.ok) return { ok: false, error: wrapped.error };
        return wrapped.result;
    }
}

module.exports = IntentEngine;
