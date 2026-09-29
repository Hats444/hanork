#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveLocalFile, isRemoteDocumentRef } = require('../src/utils/safeLocalPath');

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'hanork-safe-path-'));
const okFile = path.join(base, 'produto.txt');
fs.writeFileSync(okFile, 'ok');

let failed = 0;
function assert(cond, msg) {
    if (!cond) {
        console.error('FAIL:', msg);
        failed++;
    }
}

assert(resolveLocalFile(base, 'produto.txt') === okFile, 'basename válido');
assert(resolveLocalFile(base, '../outside.txt') === null, 'traversal via ref');
assert(resolveLocalFile(base, path.join('..', path.basename(okFile))) === null, 'segmento .. na ref');
assert(resolveLocalFile(base, '/etc/passwd') === null, 'path absoluto externo');
assert(resolveLocalFile(base, 'missing.txt') === null, 'arquivo inexistente');
assert(resolveLocalFile(base, 'text:conteudo') === null, 'prefixo text:');
assert(isRemoteDocumentRef('AgACAgIAAxk') === true, 'file_id telegram');
assert(isRemoteDocumentRef('https://x.com/f.pdf') === true, 'url http');
assert(isRemoteDocumentRef('../x.pdf') === false, 'path com ..');
assert(isRemoteDocumentRef('pasta/arquivo.pdf') === false, 'path com barra');

try {
    fs.rmSync(base, { recursive: true, force: true });
} catch {}

if (failed) {
    console.error(`\n${failed} teste(s) falharam`);
    process.exit(1);
}
console.log('OK — safeLocalPath');
