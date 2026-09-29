'use strict';

const BLOCK_TTL_MS = 15 * 60 * 1000;
const noNumbersBlocks = new Map();

function blockKey(serviceCode, countryId, server) {
    const code = String(serviceCode || '').toLowerCase();
    const cid = Number(countryId);
    const srv = Number(server) || 1;
    if (!code || !Number.isFinite(cid) || cid <= 0) return '';
    return `${code}:${cid}:${srv}`;
}

function isBlocked(serviceCode, countryId, server) {
    const key = blockKey(serviceCode, countryId, server);
    if (!key) return false;
    const at = noNumbersBlocks.get(key);
    if (!at) return false;
    if (Date.now() - at > BLOCK_TTL_MS) {
        noNumbersBlocks.delete(key);
        return false;
    }
    return true;
}

function markBlocked(serviceCode, countryId, server) {
    const key = blockKey(serviceCode, countryId, server);
    if (key) noNumbersBlocks.set(key, Date.now());
}

async function markNoNumbers(svc) {
    markBlocked(svc?.service_code, svc?.country_id, svc?.server);
}

function clearBlock(serviceCode, countryId, server) {
    const key = blockKey(serviceCode, countryId, server);
    if (key) noNumbersBlocks.delete(key);
}

function clearAllBlocks() {
    const n = noNumbersBlocks.size;
    noNumbersBlocks.clear();
    return n;
}

module.exports = {
    blockKey,
    isBlocked,
    markBlocked,
    markNoNumbers,
    clearBlock,
    clearAllBlocks,
};
