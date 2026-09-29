'use strict';

const fs = require('fs');
const path = require('path');

function manifestPath() {
    try {
        const { CONFIG } = require('../config/config');
        if (CONFIG?.CAMINHO_FOTOS) {
            return path.join(path.normalize(CONFIG.CAMINHO_FOTOS), '.promo-upload-manifest.json');
        }
    } catch {
        /* ignore */
    }
    if (process.env.CAMINHO_FOTOS) {
        return path.join(path.normalize(process.env.CAMINHO_FOTOS), '.promo-upload-manifest.json');
    }
    return path.join(process.cwd(), 'fotos', '.promo-upload-manifest.json');
}

function readManifest() {
    const fp = manifestPath();
    try {
        if (!fs.existsSync(fp)) return {};
        const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
        return raw && typeof raw === 'object' ? raw : {};
    } catch {
        return {};
    }
}

function writeManifest(data) {
    const fp = manifestPath();
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, JSON.stringify(data, null, 2) + '\n');
}

/** Registra foto enviada manualmente (/foto_hanork, /foto_smm, …). */
function markPromoUploaded(type, fileName) {
    const t = String(type || '').toLowerCase();
    const name = path.basename(String(fileName || ''));
    if (!t || !name) return;
    const data = readManifest();
    if (!data[t] || typeof data[t] !== 'object') data[t] = {};
    data[t][name] = new Date().toISOString();
    writeManifest(data);
}

function isManualPromoUpload(type, fileName) {
    const t = String(type || '').toLowerCase();
    const name = path.basename(String(fileName || ''));
    if (!t || !name) return false;
    const data = readManifest();
    return Boolean(data[t]?.[name]);
}

/** Remove do manifest entradas que não foram enviadas via /foto_* (limpa capas geradas antigas). */
function purgeManifestExceptManual(types = ['hanork', 'smm', 'virtuo', 'wadv']) {
    const data = readManifest();
    let removed = 0;
    for (const t of types) {
        if (!data[t] || typeof data[t] !== 'object') continue;
        for (const name of Object.keys(data[t])) {
            if (/^(hanork|ssm|smm|virtuo|nums|wadv|div)[-_]\d{1,2}\./i.test(name)) {
                delete data[t][name];
                removed++;
            }
        }
        if (!Object.keys(data[t]).length) delete data[t];
    }
    if (removed) writeManifest(data);
    return removed;
}

module.exports = {
    manifestPath,
    markPromoUploaded,
    isManualPromoUpload,
    purgeManifestExceptManual,
};
