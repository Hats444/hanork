'use strict';

const { v4: uuidv4 } = require('uuid');

const KEY_PREFIX = 'ctx_evt:';
const INDEX_PREFIX = 'ctx_evt_idx:';
const MAX_INDEX = 200;

class OperationalEventStore {
    constructor(dbRaw) {
        this._dbRaw = dbRaw;
    }

    _db() {
        return typeof this._dbRaw === 'function' ? this._dbRaw() : this._dbRaw;
    }

    _indexKey(tenantId) {
        return `${INDEX_PREFIX}${tenantId || 0}`;
    }

    _eventKey(tenantId, id) {
        return `${KEY_PREFIX}${tenantId || 0}:${id}`;
    }

    save(tenantId, event) {
        const id = event.id || uuidv4();
        const payload = {
            ...event,
            id,
            saved_at: new Date().toISOString(),
        };
        const key = this._eventKey(tenantId, id);
        this._db()
            .prepare(
                `INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, datetime('now'))`
            )
            .run(key, JSON.stringify(payload));

        const idxKey = this._indexKey(tenantId);
        const row = this._db().prepare('SELECT value FROM kv_store WHERE key = ?').get(idxKey);
        let ids = [];
        try {
            ids = row?.value ? JSON.parse(row.value) : [];
        } catch {
            ids = [];
        }
        ids = [id, ...ids.filter((x) => x !== id)].slice(0, MAX_INDEX);
        this._db()
            .prepare(
                `INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, datetime('now'))`
            )
            .run(idxKey, JSON.stringify(ids));

        return payload;
    }

    list(tenantId, limit = 20) {
        const idxKey = this._indexKey(tenantId);
        const row = this._db().prepare('SELECT value FROM kv_store WHERE key = ?').get(idxKey);
        let ids = [];
        try {
            ids = row?.value ? JSON.parse(row.value) : [];
        } catch {
            return [];
        }
        const out = [];
        for (const id of ids.slice(0, limit)) {
            const ev = this._db()
                .prepare('SELECT value FROM kv_store WHERE key = ?')
                .get(this._eventKey(tenantId, id));
            if (ev?.value) {
                try {
                    out.push(JSON.parse(ev.value));
                } catch {
                    /* skip */
                }
            }
        }
        return out;
    }
}

module.exports = OperationalEventStore;
