#!/usr/bin/env node
'use strict';

/**
 * Garante que sendLongHtml não entra em recursão infinita (bug /help admin).
 */

const { sendLongHtml, packLinesIntoMessages } = require('../src/telegram/htmlMessages');

let replyCalls = 0;
let editCalls = 0;

const fakeMsg = {
    async reply(_ctx, text, _mk, options = {}) {
        replyCalls++;
        if (!options.skipLongSplit) {
            throw new Error('reply sem skipLongSplit — risco de recursão');
        }
        if (String(text).length > 4096) {
            throw new Error(`parte longa demais: ${text.length}`);
        }
    },
    async editCallbackPanel(_ctx, text, _mk, options = {}) {
        editCalls++;
        if (!options.skipLongSplit) {
            throw new Error('editCallbackPanel sem skipLongSplit');
        }
    },
};

const ctx = { chat: { id: 1 }, from: { id: 1 } };
const parts = packLinesIntoMessages('• <code>/test</code> — ok\n'.repeat(400));

(async () => {
    await sendLongHtml(ctx, parts, null, { Msg: fakeMsg, forceNew: true });
    if (replyCalls + editCalls < 2) {
        console.error('FAIL: poucas chamadas', { replyCalls, editCalls });
        process.exit(1);
    }
    console.log('OK sendLongHtml —', replyCalls, 'reply,', editCalls, 'edit,', parts.length, 'partes');
})().catch((e) => {
    console.error('FAIL:', e.message);
    process.exit(1);
});
