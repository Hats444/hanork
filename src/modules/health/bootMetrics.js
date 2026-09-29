'use strict';

/**
 * Métricas de boot e idade do último sync SMM (P2-2).
 */
let _startMs = null;
let _readyMs = null;

function markBootStart() {
    if (_startMs == null) _startMs = Date.now();
}

function markBootReady() {
    if (_readyMs == null) _readyMs = Date.now();
}

function getBootSnapshot() {
    const now = Date.now();
    const start = _startMs ?? now;
    const ready = _readyMs;
    return {
        bootComplete: ready ? 1 : 0,
        bootInProgress: ready ? 0 : 1,
        bootDurationSeconds: ready ? (ready - start) / 1000 : (now - start) / 1000,
    };
}

function parseSqliteDatetime(value) {
    if (!value) return NaN;
    const s = String(value).trim();
    if (!s) return NaN;
    const iso = s.includes('T') ? s : s.replace(' ', 'T');
    const ms = Date.parse(iso.endsWith('Z') ? iso : `${iso}Z`);
    if (Number.isFinite(ms)) return ms;
    return Date.parse(s.replace(' ', 'T'));
}

function getSmmSyncSnapshot() {
    try {
        const { prisma } = require('../../config/database-sqlite');
        const last = prisma.smmSyncHistory?.last?.();
        if (!last?.finished_at) {
            return { ageSeconds: null, lastProcessed: 0, syncType: null };
        }
        const finished = parseSqliteDatetime(last.finished_at);
        if (!Number.isFinite(finished)) {
            return { ageSeconds: null, lastProcessed: last.total_processed || 0, syncType: last.sync_type };
        }
        return {
            ageSeconds: Math.max(0, (Date.now() - finished) / 1000),
            lastProcessed: last.total_processed || 0,
            syncType: last.sync_type || 'full',
        };
    } catch {
        return { ageSeconds: null, lastProcessed: 0, syncType: null };
    }
}

/** @internal testes */
function _reset() {
    _startMs = null;
    _readyMs = null;
}

module.exports = {
    markBootStart,
    markBootReady,
    getBootSnapshot,
    getSmmSyncSnapshot,
    parseSqliteDatetime,
    _reset,
};
