'use strict';

/** uid → { mode: 'hub'|'service', serviceCode?: string, at: number } */
const virtuoSearchMode = new Map();

function setVirtuoSearch(uid, scope = {}) {
    if (!uid) return;
    virtuoSearchMode.set(Number(uid), { ...scope, at: Date.now() });
}

function getVirtuoSearch(uid) {
    return virtuoSearchMode.get(Number(uid)) || null;
}

function clearVirtuoSearch(uid) {
    if (uid) virtuoSearchMode.delete(Number(uid));
}

function hasVirtuoSearch(uid) {
    return virtuoSearchMode.has(Number(uid));
}

module.exports = {
    virtuoSearchMode,
    setVirtuoSearch,
    getVirtuoSearch,
    clearVirtuoSearch,
    hasVirtuoSearch,
};
