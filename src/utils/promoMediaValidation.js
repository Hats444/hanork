'use strict';

const logger = require('../config/logger');
const { resolvePromoPhotoPath } = require('./promoMediaPaths');

function isHanorkPhotoFile(fileName) {
    if (!fileName) return false;
    return /^(hanork[-_]|hanork-promo-)/i.test(fileName) || fileName === 'hanork_1.jpg';
}

function isVirtuoPhotoFile(fileName) {
    if (!fileName) return false;
    return /^(virtuo[-_]|nums[-_]|virtuo_divulgacao)/i.test(fileName);
}

function isSmmPhotoFile(fileName) {
    if (!fileName) return false;
    return /^(ssm[-_]|smm_)/i.test(fileName);
}

/**
 * Valida par texto↔mídia antes do envio.
 * @returns {{ ok: boolean, reason?: string }}
 */
function validatePromoPair(type, { variant, photo, photoFile, photosDir } = {}) {
    const t = String(type || '').toLowerCase();
    const variantId = variant?.id || 'unknown';

    if (!photo) {
        logger.error('[PromoMedia] mídia ausente — envio bloqueado', {
            type: t,
            variantId,
            photoFile: photoFile || variant?.image_file || null,
            photosDir: photosDir || null,
        });
        return { ok: false, reason: 'missing_photo' };
    }

    const name = photoFile || variant?.image_file || '';
    if (t === 'hanork' && name && isSmmPhotoFile(name)) {
        logger.error('[PromoMedia] mistura bloqueada — texto HANORK com mídia SMM', {
            variantId,
            photoFile: name,
        });
        return { ok: false, reason: 'hanork_with_smm_media' };
    }
    if (t === 'smm' && name && isHanorkPhotoFile(name)) {
        logger.error('[PromoMedia] mistura bloqueada — texto SMM com mídia HANORK', {
            variantId,
            photoFile: name,
        });
        return { ok: false, reason: 'smm_with_hanork_media' };
    }
    if (t === 'virtuo' && name && (isHanorkPhotoFile(name) || isSmmPhotoFile(name))) {
        logger.error('[PromoMedia] mistura bloqueada — texto Virtuo com mídia de outro tipo', {
            variantId,
            photoFile: name,
        });
        return { ok: false, reason: 'virtuo_with_wrong_media' };
    }
    if (t === 'hanork' && name && (isSmmPhotoFile(name) || isVirtuoPhotoFile(name))) {
        logger.error('[PromoMedia] mistura bloqueada — texto HANORK com mídia de outro tipo', {
            variantId,
            photoFile: name,
        });
        return { ok: false, reason: 'hanork_with_wrong_media' };
    }

    if (photosDir && name) {
        const resolved = resolvePromoPhotoPath(t, name, photosDir);
        if (!resolved) {
            logger.error('[PromoMedia] arquivo não encontrado no disco', {
                type: t,
                variantId,
                photoFile: name,
                photosDir,
            });
            return { ok: false, reason: 'file_not_found' };
        }
    }

    return { ok: true };
}

module.exports = {
    validatePromoPair,
    isHanorkPhotoFile,
    isSmmPhotoFile,
    isVirtuoPhotoFile,
};
