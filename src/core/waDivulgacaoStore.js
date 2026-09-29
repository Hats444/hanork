'use strict';

const { connect: dbConnect } = require('../../config/database-sqlite');

const PREFIX_SETTINGS = 'wadv_settings:';
const PREFIX_HISTORY = 'wadv_history:';
const MAX_HISTORY = 25;
const MAX_TEMPLATES = 5;
const MAX_GROUP_LISTS = 5;

const DEFAULT_SETTINGS = {
    defaultDelayMs: 15000,
    defaultMode: 'status',
    templates: [],
    groupLists: [],
    allowedHours: null,
    paceMode: 'normal',
};

function settingsKey(telegramId) {
    return `${PREFIX_SETTINGS}${String(telegramId)}`;
}

function historyKey(telegramId) {
    return `${PREFIX_HISTORY}${String(telegramId)}`;
}

function readJson(key, fallback) {
    const db = dbConnect();
    if (!db) return fallback;
    try {
        const row = db.prepare('SELECT value FROM kv_store WHERE key=?').get(key);
        if (!row?.value) return fallback;
        return JSON.parse(row.value);
    } catch {
        return fallback;
    }
}

function writeJson(key, value) {
    const db = dbConnect();
    if (!db) return;
    db.prepare(
        `INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, datetime('now'))`
    ).run(key, JSON.stringify(value));
}

function getUserSettings(telegramId) {
    const raw = readJson(settingsKey(telegramId), null);
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS };
    return {
        defaultDelayMs: Number(raw.defaultDelayMs) || DEFAULT_SETTINGS.defaultDelayMs,
        defaultMode: raw.defaultMode || DEFAULT_SETTINGS.defaultMode,
        templates: Array.isArray(raw.templates) ? raw.templates.slice(0, MAX_TEMPLATES) : [],
        groupLists: Array.isArray(raw.groupLists) ? raw.groupLists.slice(0, MAX_GROUP_LISTS) : [],
        allowedHours: raw.allowedHours || null,
        paceMode: raw.paceMode || DEFAULT_SETTINGS.paceMode,
    };
}

function saveUserSettings(telegramId, patch) {
    const cur = getUserSettings(telegramId);
    const next = { ...cur, ...patch };
    if (patch.templates) {
        next.templates = patch.templates.slice(0, MAX_TEMPLATES);
    }
    if (patch.groupLists) {
        next.groupLists = patch.groupLists.slice(0, MAX_GROUP_LISTS);
    }
    writeJson(settingsKey(telegramId), next);
    return next;
}

function addGroupList(telegramId, name, groupIds) {
    const ids = [...new Set((groupIds || []).map(String).filter(Boolean))];
    if (!ids.length) return getUserSettings(telegramId);
    const cur = getUserSettings(telegramId);
    const listName = String(name || `Lista ${cur.groupLists.length + 1}`).slice(0, 32);
    const groupLists = [{ id: `gl-${Date.now()}`, name: listName, groupIds: ids }, ...cur.groupLists].slice(
        0,
        MAX_GROUP_LISTS
    );
    return saveUserSettings(telegramId, { groupLists });
}

function getGroupList(telegramId, listId) {
    const cur = getUserSettings(telegramId);
    return cur.groupLists.find((l) => l.id === listId) || null;
}

function addTemplate(telegramId, text) {
    const t = String(text || '').trim();
    if (!t) return getUserSettings(telegramId);
    const cur = getUserSettings(telegramId);
    const templates = [t, ...cur.templates.filter((x) => x !== t)].slice(0, MAX_TEMPLATES);
    return saveUserSettings(telegramId, { templates });
}

function getHistory(telegramId) {
    const rows = readJson(historyKey(telegramId), []);
    return Array.isArray(rows) ? rows : [];
}

function appendHistory(telegramId, entry) {
    const rows = getHistory(telegramId);
    rows.unshift({
        ...entry,
        at: entry.at || new Date().toISOString(),
    });
    writeJson(historyKey(telegramId), rows.slice(0, MAX_HISTORY));
}

function updateHistoryEntry(telegramId, jobId, patch) {
    const rows = getHistory(telegramId);
    const idx = rows.findIndex((r) => r.jobId === jobId);
    if (idx < 0) return rows;
    rows[idx] = { ...rows[idx], ...patch };
    writeJson(historyKey(telegramId), rows);
    return rows;
}

function countScheduled(telegramId) {
    return getHistory(telegramId).filter((r) => r.status === 'scheduled').length;
}

function historyTotals(telegramId) {
    const rows = getHistory(telegramId);
    let sent = 0;
    let failed = 0;
    let campaigns = 0;
    for (const r of rows) {
        if (r.status === 'done' || r.sent != null) {
            campaigns += 1;
            sent += Number(r.sent) || 0;
            failed += Number(r.failed) || 0;
        }
    }
    return { campaigns, sent, failed, rows };
}

module.exports = {
    getUserSettings,
    saveUserSettings,
    addTemplate,
    addGroupList,
    getGroupList,
    getHistory,
    appendHistory,
    updateHistoryEntry,
    historyTotals,
    countScheduled,
    MAX_TEMPLATES,
    MAX_GROUP_LISTS,
};
