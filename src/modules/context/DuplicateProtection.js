'use strict';

const crypto = require('crypto');

const PREFIX = 'ctx:dup:';
const TTL_MS = 90 * 1000;

class DuplicateProtection {
    constructor(stateManager) {
        this._state = stateManager;
    }

    _hash(tenantId, operatorId, text) {
        const norm = String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
        return crypto
            .createHash('sha256')
            .update(`${tenantId}:${operatorId}:${norm}`)
            .digest('hex')
            .slice(0, 24);
    }

    isDuplicate(tenantId, operatorId, text) {
        const key = `${PREFIX}${this._hash(tenantId, operatorId, text)}`;
        if (this._state.get(key)) return true;
        this._state.set(key, { at: Date.now() }, TTL_MS);
        return false;
    }
}

module.exports = DuplicateProtection;
