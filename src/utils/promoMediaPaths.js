'use strict';

const path = require('path');
const fs = require('fs');
const { listResolvableMediaDirs } = require('./wslMediaPath');

const PROMO_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);

/** Subpastas aceitas dentro de CAMINHO_FOTOS (ex.: fotos/hanork, fotos/midias/ssm). */
function promoDirName(type) {
    const t = String(type || '').toLowerCase();
    if (t === 'smm') return 'ssm';
    if (t === 'virtuo' || t === 'numeros' || t === 'nums') return 'virtuo';
    return t;
}

function promoSubdirs(type) {
    const d = promoDirName(type);
    return [d, path.join('midias', d)];
}

function isPromoImageFile(name) {
    if (!name) return false;
    const ext = path.extname(name).toLowerCase();
    return PROMO_EXT.has(ext);
}

function fileExists(fp) {
    try {
        return fs.existsSync(fp) && fs.statSync(fp).isFile();
    } catch {
        return false;
    }
}

/**
 * Resolve caminho físico de uma mídia de divulgação (HANORK ou SMM).
 * @returns {{ baseDir: string, fileName: string, fullPath: string }|null}
 */
function resolvePromoPhotoPath(type, fileName, photosDir) {
    if (!fileName || !photosDir) return null;
    const normalizedDir = path.normalize(String(photosDir));

    for (const sub of promoSubdirs(type)) {
        const dir = path.join(normalizedDir, sub);
        const fp = path.join(dir, fileName);
        if (fileExists(fp)) {
            return { baseDir: dir, fileName, fullPath: fp };
        }
    }

    const flat = path.join(normalizedDir, fileName);
    if (fileExists(flat)) {
        return { baseDir: normalizedDir, fileName, fullPath: flat };
    }

    return null;
}

function buildCandidateNames(type, variant, index) {
    const n = Math.max(1, (index ?? 0) + 1);
    const pad = String(n).padStart(2, '0');
    const names = [];
    if (variant?.image_file) names.push(variant.image_file);

    if (type === 'hanork') {
        names.push(
            `hanork_${pad}.jpg`,
            `hanork_${n}.jpg`,
            `hanork-promo-${pad}.jpg`,
            `hanork-promo-${pad}.png`
        );
    } else if (type === 'smm') {
        names.push(`ssm_${pad}.jpg`, `ssm_${n}.jpg`, `smm_${pad}.jpg`);
        if (n === 1) names.push('smm_divulgacao.jpg');
    } else if (type === 'virtuo' || type === 'numeros' || type === 'nums') {
        names.push(`virtuo_${pad}.jpg`, `virtuo_${n}.jpg`, `nums_${pad}.jpg`);
        if (n === 1) names.push('virtuo_divulgacao.jpg');
    }

    return [...new Set(names.filter(isPromoImageFile))];
}

function listPromoPhotos(type, photosDir) {
    if (!photosDir || !fs.existsSync(photosDir)) return [];
    const found = new Set();
    const roots = [photosDir, ...promoSubdirs(type).map((s) => path.join(photosDir, s))];
    const t = String(type || '').toLowerCase();
    const re =
        t === 'hanork'
            ? /^(hanork[-_]|hanork-promo-)/i
            : t === 'virtuo' || t === 'numeros' || t === 'nums'
              ? /^(virtuo[-_]|nums[-_]|virtuo_divulgacao)/i
              : /^(ssm[-_]|smm_divulgacao)/i;

    for (const root of roots) {
        if (!fs.existsSync(root)) continue;
        for (const name of fs.readdirSync(root)) {
            if (!isPromoImageFile(name) || !re.test(name)) continue;
            if (fileExists(path.join(root, name))) found.add(name);
        }
    }
    return [...found].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

const { resolvePhotoInput } = require('../telegram/messageDelivery');

/**
 * Resolve mídia pareada ao tema (texto N ↔ imagem N).
 * @returns {{ photoFile: string|null, photo: object|string|null, photoPath: string|null }}
 */
function resolvePairedPromoPhoto(type, variant, index, photosDir) {
    const candidates = buildCandidateNames(type, variant, index);
    const searchDirs = listResolvableMediaDirs(photosDir, path.join(process.cwd(), 'fotos'));

    for (const name of candidates) {
        for (const dir of searchDirs) {
            const located = resolvePromoPhotoPath(type, name, dir);
            if (located) {
                return {
                    photoFile: name,
                    photo: resolvePhotoInput({ source: located.fullPath }),
                    photoPath: located.fullPath,
                };
            }
        }
    }

    for (const dir of searchDirs) {
        const anyNames = listPromoPhotos(type, dir);
        for (const name of anyNames) {
            const located = resolvePromoPhotoPath(type, name, dir);
            if (located) {
                return {
                    photoFile: name,
                    photo: resolvePhotoInput({ source: located.fullPath }),
                    photoPath: located.fullPath,
                };
            }
        }
    }

    return {
        photoFile: candidates[0] || variant?.image_file || null,
        photo: null,
        photoPath: null,
    };
}

module.exports = {
    promoDirName,
    promoSubdirs,
    isPromoImageFile,
    resolvePromoPhotoPath,
    buildCandidateNames,
    listPromoPhotos,
    resolvePairedPromoPhoto,
};
