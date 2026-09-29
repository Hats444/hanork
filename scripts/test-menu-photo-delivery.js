'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const assert = (cond, msg) => {
    if (!cond) throw new Error(msg);
};

const { isLocalFilePhotoInput } = require('../src/telegram/messageDelivery');

const tmp = path.join(os.tmpdir(), `hanork-menu-photo-test-${Date.now()}.jpg`);
fs.writeFileSync(tmp, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]));

assert(isLocalFilePhotoInput({ source: tmp }), 'local file detected');
assert(!isLocalFilePhotoInput('AgACAgIAAxkBAAI'), 'file_id not local');
assert(!isLocalFilePhotoInput('https://example.com/a.jpg'), 'url not local');

fs.unlinkSync(tmp);
console.log('RESULT: OK');
