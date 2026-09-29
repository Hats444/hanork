'use strict';

const assert = (cond, msg) => {
    if (!cond) throw new Error(msg);
};

const path = require('path');
const fs = require('fs');
const os = require('os');
const { isValidScreenImageFile, isValidImageFile, SCREEN_IMAGE_MIN_BYTES } = require('../src/utils/imageFileValidation');
const { findScreenFile, getScreenPhotoInput } = require('../src/telegram/screenPhoto');

const tiny = path.join(os.tmpdir(), `hanork-tiny-${Date.now()}.jpg`);
fs.writeFileSync(
    tiny,
    Buffer.from([
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48,
        0x00, 0x48, 0x00, 0x00,
    ])
);

assert(!isValidScreenImageFile(tiny), 'tiny placeholder rejected for screen');
assert(isValidImageFile(tiny, 16), 'tiny ok with low min for unit test');

const wslIg = '/home/vendetta/hanork/assets/images/instagram.jpg';
if (fs.existsSync(wslIg)) {
    const st = fs.statSync(wslIg);
    if (st.size < SCREEN_IMAGE_MIN_BYTES) {
        assert(!isValidScreenImageFile(wslIg), 'production placeholder instagram.jpg rejected');
        const fallback = getScreenPhotoInput('instagram', 1);
        assert(fallback && (typeof fallback === 'string' || fallback.source), 'fallback to menu after reject');
    }
}

assert(findScreenFile('instagram') === null || isValidScreenImageFile(findScreenFile('instagram')), 'findScreenFile only valid');

fs.unlinkSync(tiny);
console.log('RESULT: OK');
