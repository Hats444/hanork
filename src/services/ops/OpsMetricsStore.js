'use strict';

const MAX_EVENTS = 200;

const KEY_EVENTS = 'ops:events';
const KEY_COUNTERS = 'ops:counters';

function dbGet(db, key) {
    try {
        return db.prepare('SELECT value FROM kv_store WHERE key=?').get(key)?.value ?? null;
    } catch {
        return null;
    }
}

function dbSet(db, key, value) {
    db.prepare(
        `INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, datetime('now'))`
    ).run(key, value);
}

/**
 * @param {import('better-sqlite3').Database} db
 */
function record(db, event) {
    if (!db) return;
    const ts = Date.now();
    const entry = {
        ts,
        channel: event.channel || 'system',
        kind: event.kind || 'info',
        target: event.target ? String(event.target).slice(0, 120) : '',
        detail: event.detail ? String(event.detail).slice(0, 240) : '',
        countermeasure: event.countermeasure || '',
    };

    let events = [];
    try {
        const raw = dbGet(db, KEY_EVENTS);
        events = raw ? JSON.parse(raw) : [];
    } catch {
        events = [];
    }
    events.push(entry);
    if (events.length > MAX_EVENTS) events = events.slice(-MAX_EVENTS);
    dbSet(db, KEY_EVENTS, JSON.stringify(events));

    let counters = {};
    try {
        const raw = dbGet(db, KEY_COUNTERS);
        counters = raw ? JSON.parse(raw) : {};
    } catch {
        counters = {};
    }
    const ck = `${entry.channel}:${entry.kind}`;
    counters[ck] = (counters[ck] || 0) + 1;
    counters._updatedAt = ts;
    dbSet(db, KEY_COUNTERS, JSON.stringify(counters));
}

function getRecent(db, limit = 25) {
    try {
        const raw = dbGet(db, KEY_EVENTS);
        const events = raw ? JSON.parse(raw) : [];
        return events.slice(-limit).reverse();
    } catch {
        return [];
    }
}

function getCounters(db) {
    try {
        const raw = dbGet(db, KEY_COUNTERS);
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
}

function readWaOpsEvents(ipcDir, limit = 30) {
    if (!ipcDir) return [];
    try {
        const fs = require('fs');
        const path = require('path');
        const file = path.join(ipcDir, 'ops-events.jsonl');
        if (!fs.existsSync(file)) return [];
        const lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
        return lines
            .slice(-limit)
            .map((line) => {
                try {
                    return JSON.parse(line);
                } catch {
                    return null;
                }
            })
            .filter(Boolean)
            .reverse();
    } catch {
        return [];
    }
}

module.exports = {
    record,
    getRecent,
    getCounters,
    readWaOpsEvents,
    KEY_EVENTS,
    KEY_COUNTERS,
};
