#!/usr/bin/env node
'use strict';

/**
 * Garante better-sqlite3 compilado para o Node atual (evita ERR_DLOPEN_FAILED).
 */
const { execSync } = require('child_process');

function tryLoad() {
    // eslint-disable-next-line import/no-extraneous-dependencies
    require('better-sqlite3')(':memory:');
}

try {
    tryLoad();
    if (process.env.HANORK_NATIVE_VERBOSE === '1') {
        console.log(`[native] better-sqlite3 OK (${process.version})`);
    }
} catch (e) {
    if (e?.code !== 'ERR_DLOPEN_FAILED') {
        throw e;
    }
    console.warn(`[native] better-sqlite3 incompatível com ${process.version} — recompilando…`);
    execSync('npm rebuild better-sqlite3', { stdio: 'inherit', cwd: require('path').join(__dirname, '..') });
    tryLoad();
    console.log(`[native] better-sqlite3 OK após rebuild (${process.version})`);
}
