'use strict';

const assert = require('assert');
const {
    toValidUtf8,
    truncateUnicode,
    truncateButtonText,
    sanitizeReplyMarkup,
} = require('../src/telegram/telegramButtonText');

// Surrogate órfão (meio de emoji cortado) — causa erro UTF-8 no Telegram
const broken = 'Kaleb \uD83C';
assert.strictEqual(toValidUtf8(broken), 'Kaleb ');
assert.ok(!toValidUtf8(broken).includes('\uD83C'));

const emojiTitle = '① Elite do Mundo 🎵 Kaito';
const truncated = truncateUnicode(emojiTitle, 12);
assert.ok([...truncated].length <= 12);
assert.ok(Buffer.from(truncated, 'utf8').toString('utf8') === truncated);

const longBtn = `① ${'á'.repeat(80)} · 3:45`;
const btn = truncateButtonText(longBtn, 64);
assert.ok([...btn].length <= 64);

const kb = sanitizeReplyMarkup({
    inline_keyboard: [[{ text: `① tipo kaleb \uD800 mhrap · 3:21`, callback_data: 'play:pick:x:0' }]],
});
assert.ok(kb.inline_keyboard[0][0].text);
assert.ok(!kb.inline_keyboard[0][0].text.includes('\uD800'));
assert.ok([...kb.inline_keyboard[0][0].text].length <= 64);

console.log('test-telegram-button-text: OK');
