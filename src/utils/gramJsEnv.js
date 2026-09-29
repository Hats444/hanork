'use strict';

/**
 * Node 22+ expõe localStorage experimental que quebra o cache TL do GramJS.
 * Garante polyfill estável antes de require('telegram').
 */
const fs = require('fs');
const path = require('path');

function installGramJsLocalStorage() {
    const root = path.join(__dirname, '../../data/gramjs-localstorage');
    try {
        fs.mkdirSync(root, { recursive: true });
    } catch {
        /* ignore */
    }

    const opts = process.env.NODE_OPTIONS || '';
    if (opts.includes('--localstorage-file') && !/--localstorage-file=\S+/.test(opts)) {
        process.env.NODE_OPTIONS = opts.replace(/--localstorage-file(?:=\S*)?/g, ' ').replace(/\s+/g, ' ').trim();
    }

    const broken =
        typeof globalThis.localStorage !== 'undefined' &&
        typeof globalThis.localStorage.getItem !== 'function';

    if (broken) {
        try {
            delete globalThis.localStorage;
        } catch {
            globalThis.localStorage = undefined;
        }
    }

    if (typeof globalThis.localStorage === 'undefined') {
        try {
            const { LocalStorage } = require('node-localstorage');
            globalThis.localStorage = new LocalStorage(root);
        } catch {
            /* pacote opcional — GramJS funciona sem cache */
        }
    }
}

installGramJsLocalStorage();

module.exports = { installGramJsLocalStorage };
