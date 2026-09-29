'use strict';

const fs = require('fs');

/** Rejeita arquivos vazios/corrompidos que viram quadrado preto no Telegram. */
function isValidImageFile(fp, minBytes = 512) {
    try {
        const st = fs.statSync(fp);
        if (!st.isFile() || st.size < minBytes) return false;
        const fd = fs.openSync(fp, 'r');
        const buf = Buffer.alloc(12);
        fs.readSync(fd, buf, 0, 12, 0);
        fs.closeSync(fd);
        if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
        if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true;
        if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return true;
        if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return true;
        return false;
    } catch {
        return false;
    }
}

/** Capas de tela (assets/images) — placeholders minúsculos viram quadrado preto. */
const SCREEN_IMAGE_MIN_BYTES = 4096;

function isValidScreenImageFile(fp) {
    return isValidImageFile(fp, SCREEN_IMAGE_MIN_BYTES);
}

module.exports = {
    isValidImageFile,
    isValidScreenImageFile,
    SCREEN_IMAGE_MIN_BYTES,
};
