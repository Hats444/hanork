#!/usr/bin/env node
'use strict';

const { buildHelpParts } = require('../src/telegram/commands/botCommandsCatalog');
const { packLinesIntoMessages, TELEGRAM_HTML_CHUNK } = require('../src/telegram/htmlMessages');

function assert(cond, msg) {
    if (!cond) {
        console.error('FAIL:', msg);
        process.exit(1);
    }
}

const adminAll = buildHelpParts(true, 'all');
const user = buildHelpParts(false, 'user');

assert(adminAll.length >= 2, 'admin all deve ter várias partes');
assert(user.length === 1, 'user deve caber em uma parte');

for (const parts of [adminAll, user]) {
    const joined = parts.join('');
    assert(joined.includes('/help'), 'deve listar /help');
    assert(joined.includes('/checkout'), 'deve listar comandos cliente');
    for (const p of parts) {
        assert(p.length <= TELEGRAM_HTML_CHUNK, `parte longa demais: ${p.length}`);
        assert(!p.includes('<code>/</code> —'), 'não deve cortar tag code no meio');
    }
}

const painel = buildHelpParts(true, 'painel');
assert(painel.join('').includes('/admin'), 'painel menciona /admin');

const html = '• <code>/test</code> — ok\n'.repeat(500);
const packed = packLinesIntoMessages(html.split('\n'));
assert(packed.length > 1, 'linhas longas devem virar várias partes');
for (const p of packed) {
    const opens = (p.match(/<code>/g) || []).length;
    const closes = (p.match(/<\/code>/g) || []).length;
    assert(opens === closes, 'tags code balanceadas por parte');
}

console.log('OK help split —', adminAll.length, 'partes admin,', user.length, 'parte user');
