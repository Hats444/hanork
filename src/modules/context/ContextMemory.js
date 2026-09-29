'use strict';

/**
 * Memória contextual curta por tenant + operador (StateManager).
 * Não substitui RedisState — usa prefixo ctx:mem:
 */
const PREFIX = 'ctx:mem:';
const DEFAULT_TTL_MS = 30 * 60 * 1000;

class ContextMemory {
    constructor(stateManager) {
        this._state = stateManager;
    }

    _key(tenantId, operatorId) {
        return `${PREFIX}${tenantId || 0}:${operatorId}`;
    }

    get(tenantId, operatorId) {
        return this._state.get(this._key(tenantId, operatorId)) || {
            lastClient: null,
            lastIntent: null,
            history: [],
        };
    }

    set(tenantId, operatorId, data) {
        this._state.set(this._key(tenantId, operatorId), data, DEFAULT_TTL_MS);
    }

    remember(tenantId, operatorId, patch) {
        const cur = this.get(tenantId, operatorId);
        const next = {
            ...cur,
            ...patch,
            history: [
                ...(cur.history || []).slice(-9),
                { at: Date.now(), ...(patch.snapshot || {}) },
            ],
        };
        this.set(tenantId, operatorId, next);
        return next;
    }

    resolveClient(tenantId, operatorId, entities, rawText) {
        if (entities.client) return entities.client;
        const mem = this.get(tenantId, operatorId);
        if (entities.pronounRef && mem.lastClient) return mem.lastClient;
        const loc = entities.location;
        if (loc) return loc;
        return null;
    }

    updateFromParse(tenantId, operatorId, parsed) {
        const client =
            parsed.entities?.client ||
            parsed.entities?.location ||
            null;
        return this.remember(tenantId, operatorId, {
            lastClient: client || this.get(tenantId, operatorId).lastClient,
            lastIntent: parsed.type,
            snapshot: { type: parsed.type, client, amount: parsed.entities?.amount },
        });
    }
}

module.exports = ContextMemory;
