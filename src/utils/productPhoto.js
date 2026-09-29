'use strict';

const path = require('path');
const { resolveLocalFile } = require('./safeLocalPath');
const { isUsablePhotoUrl, resolvePhotoInput } = require('../telegram/messageDelivery');
const { isValidImageFile } = require('./imageFileValidation');

function getProductPhotoDirs(photosDir) {
    const dirs = [];
    if (photosDir) dirs.push(path.normalize(String(photosDir)));
    try {
        const { CONFIG } = require('../config/config');
        if (CONFIG?.CAMINHO_FOTOS) dirs.push(path.normalize(CONFIG.CAMINHO_FOTOS));
    } catch {
        /* ignore */
    }
    if (process.env.CAMINHO_FOTOS) dirs.push(path.normalize(process.env.CAMINHO_FOTOS));
    dirs.push(path.normalize(path.join(__dirname, '../../fotos')));
    dirs.push(path.normalize(path.join(process.cwd(), 'fotos')));
    return [...new Set(dirs.filter(Boolean))];
}

/** Resolve foto de capa do produto — somente fotos/ (ou URL remota). */
function resolveProductPhotoInput(product, photosDir) {
    if (!product) return null;
    if (product.photo_url && isUsablePhotoUrl(String(product.photo_url))) {
        return resolvePhotoInput(product.photo_url);
    }
    if (product.photo) {
        for (const dir of getProductPhotoDirs(photosDir)) {
            const fp = resolveLocalFile(dir, product.photo);
            if (fp && isValidImageFile(fp)) return resolvePhotoInput({ source: fp });
        }
        return resolvePhotoInput(product.photo);
    }
    return null;
}

/**
 * Foto do produto em fotos/; se não existir, usa menu (infos/menu*.jpg).
 * @returns {{ photo: object|string|null, usedMenuFallback: boolean }}
 */
function resolveProductPhotoWithMenuFallback(product, photosDir, rotateKey = null) {
    const productPhoto = resolveProductPhotoInput(product, photosDir);
    if (productPhoto) {
        return { photo: productPhoto, usedMenuFallback: false };
    }
    const { getMenuPhotoInput } = require('../telegram/menuPhoto');
    const rk =
        rotateKey != null
            ? rotateKey
            : product?.id != null
              ? `prod-photo:${product.id}`
              : 'prod-photo-fallback';
    const menuRaw = getMenuPhotoInput(null, rk);
    const menuPhoto = menuRaw ? resolvePhotoInput(menuRaw) : null;
    return { photo: menuPhoto, usedMenuFallback: !!menuPhoto };
}

/** Foto do produto ou menu (infos/) quando produto não tem capa em fotos/. */
function resolveProductPhotoInputOrMenu(product, photosDir, rotateKey = null) {
    return resolveProductPhotoWithMenuFallback(product, photosDir, rotateKey).photo;
}

module.exports = {
    getProductPhotoDirs,
    resolveProductPhotoInput,
    resolveProductPhotoWithMenuFallback,
    resolveProductPhotoInputOrMenu,
};
