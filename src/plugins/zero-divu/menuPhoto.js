'use strict';

const fs = require('fs');
const path = require('path');
const { isUsablePhotoUrl } = require('./messageDelivery');
const { isValidImageFile } = require('../utils/imageFileValidation');

/** menu.jpg, menu2.jpg … menu99.png — única fonte de fotos de menu (pasta infos/). */
const MENU_FILE_RE = /^menu(\d*)\.(jpe?g|png|webp|gif)$/i;

const INFOS_DIR = path.join(__dirname, '../../infos');

let rotateIdx = 0;
const perUserRotate = new Map();

let cachedMenuFiles = null;
let cachedDirsKey = '';

/** Pastas exclusivas de menu (infos/) — nunca fotos/ de produtos. */
function resolveMenuDirs() {
    const dirs = [];
    const envInf = process.env.CAMINHO_INFOS?.trim();
    if (envInf) dirs.push(path.normalize(envInf));
    try {
        const cfg = require('../config/config');
        if (cfg.CAMINHO_INFOS) dirs.push(path.normalize(cfg.CAMINHO_INFOS));
    } catch {
        /* ignore */
    }
    dirs.push(path.normalize(INFOS_DIR));
    dirs.push(path.normalize(path.join(process.cwd(), 'infos')));
    return [...new Set(dirs.filter(Boolean))];
}

function menuSortKey(filename) {
    const m = String(filename).match(/^menu(\d*)\./i);
    if (!m) return 9999;
    if (m[1] === '') return 1;
    const n = parseInt(m[1], 10);
    return Number.isFinite(n) ? n : 9999;
}

function sortMenuPhotos(files) {
    return [...files].sort((a, b) => {
        const ka = menuSortKey(path.basename(a));
        const kb = menuSortKey(path.basename(b));
        if (ka !== kb) return ka - kb;
        return path.basename(a).localeCompare(path.basename(b), undefined, { sensitivity: 'base' });
    });
}

/** Só arquivos menu*.ext em uma pasta infos. */
function scanMenuPhotosInDir(dir) {
    if (!dir || !fs.existsSync(dir)) return [];
    let names;
    try {
        names = fs.readdirSync(dir);
    } catch {
        return [];
    }
    const out = [];
    for (const name of names) {
        if (!MENU_FILE_RE.test(name)) continue;
        const fp = path.join(dir, name);
        if (!isValidMenuImageFile(fp)) continue;
        out.push(fp);
    }
    return sortMenuPhotos(out);
}

function dirsFingerprint() {
    const parts = [];
    const seen = new Set();
    for (const dir of resolveMenuDirs()) {
        if (!dir || !fs.existsSync(dir)) continue;
        let names;
        try {
            names = fs.readdirSync(dir);
        } catch {
            continue;
        }
        for (const name of names) {
            if (!MENU_FILE_RE.test(name)) continue;
            const fp = path.normalize(path.join(dir, name));
            if (seen.has(fp)) continue;
            seen.add(fp);
            try {
                const st = fs.statSync(fp);
                parts.push(`${fp}:${st.mtimeMs}:${st.size}`);
            } catch {
                parts.push(fp);
            }
        }
    }
    parts.sort();
    return parts.join('|');
}

/** Rejeita arquivos vazios/corrompidos que viram quadrado preto no Telegram. */
function isValidMenuImageFile(fp) {
    return isValidImageFile(fp, 512);
}

function menuPhotoSkipSet() {
    const raw = process.env.MENU_PHOTO_SKIP || '';
    return new Set(
        raw
            .split(',')
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean)
    );
}

function listExistingMenuFiles() {
    const skip = menuPhotoSkipSet();
    const seen = new Set();
    const found = [];
    for (const dir of resolveMenuDirs()) {
        for (const fp of scanMenuPhotosInDir(dir)) {
            const norm = path.normalize(fp);
            if (seen.has(norm)) continue;
            if (skip.has(path.basename(norm).toLowerCase())) continue;
            seen.add(norm);
            found.push(norm);
        }
    }
    return sortMenuPhotos(found);
}

function warmMenuPhotoCache() {
    const key = dirsFingerprint();
    if (cachedMenuFiles && cachedDirsKey === key) return cachedMenuFiles;
    cachedDirsKey = key;
    cachedMenuFiles = listExistingMenuFiles();
    return cachedMenuFiles;
}

function invalidateMenuPhotoCache() {
    cachedMenuFiles = null;
    cachedDirsKey = '';
}

/**
 * Foto de menu para PV, admin, relatórios — somente infos/menu*.jpg (nunca fotos/ de produtos).
 *
 * @param {number|string|null} [userId] — contador por usuário/chave
 * @param {string|null} [rotateKeyOrLegacyDirs] — chave de rotação (ex. ops-report:adminId)
 * @param {string|null} [legacyRotateKey] — compat. chamadas antigas com extraDirs no meio
 * @param {{ rotate?: boolean }} [opts] — rotate=false mantém foto atual (edições de callback)
 */
function getMenuPhotoInput(userId, rotateKeyOrLegacyDirs = null, legacyRotateKey = null, opts = {}) {
    if (
        rotateKeyOrLegacyDirs &&
        typeof rotateKeyOrLegacyDirs === 'object' &&
        !Array.isArray(rotateKeyOrLegacyDirs) &&
        ('rotate' in rotateKeyOrLegacyDirs || Object.keys(rotateKeyOrLegacyDirs).length > 0)
    ) {
        return getMenuPhotoInput(userId, null, null, rotateKeyOrLegacyDirs);
    }
    const rotate = opts.rotate !== false;
    let rotateKey = null;
    if (Array.isArray(rotateKeyOrLegacyDirs)) {
        rotateKey = legacyRotateKey != null ? String(legacyRotateKey) : null;
    } else if (rotateKeyOrLegacyDirs != null && String(rotateKeyOrLegacyDirs).trim() !== '') {
        rotateKey = String(rotateKeyOrLegacyDirs);
    }

    const menuUrl = process.env.MENU_PHOTO_URL?.trim();
    if (menuUrl && isUsablePhotoUrl(menuUrl)) {
        return menuUrl;
    }

    const files = warmMenuPhotoCache();
    if (!files.length) return null;
    if (files.length === 1) return { source: files[0] };

    const rk =
        rotateKey != null
            ? rotateKey
            : userId != null
              ? String(userId)
              : null;

    let idx;
    if (rk != null) {
        const n = perUserRotate.get(rk) || 0;
        idx = n % files.length;
        if (rotate) perUserRotate.set(rk, n + 1);
    } else {
        idx = rotateIdx % files.length;
        rotateIdx = (rotateIdx + 1) % files.length;
    }

    return { source: files[idx] };
}

function resetMenuPhotoRotation() {
    rotateIdx = 0;
    perUserRotate.clear();
}

module.exports = {
    MENU_FILE_RE,
    INFOS_DIR,
    resolveMenuDirs,
    getMenuPhotoInput,
    listExistingMenuFiles,
    warmMenuPhotoCache,
    invalidateMenuPhotoCache,
    resetMenuPhotoRotation,
    scanMenuPhotosInDir,
    menuSortKey,
    sortMenuPhotos,
};
