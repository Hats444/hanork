#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const zipPath = path.join(__dirname, '../produtos/hanork-bot-v3.zip');
const buf = fs.readFileSync(zipPath);
const names = [];
let offset = 0;
while (offset < buf.length - 30) {
    if (buf.readUInt32LE(offset) !== 0x04034b50) {
        offset++;
        continue;
    }
    const nameLen = buf.readUInt16LE(offset + 26);
    const extra = buf.readUInt16LE(offset + 28);
    const name = buf.slice(offset + 30, offset + 30 + nameLen).toString('utf8');
    names.push(name);
    offset += 30 + nameLen + extra;
}
const bad = names.filter(
    (n) =>
        (n.includes('.env') && !n.endsWith('.env.example')) ||
        n.endsWith('.db') ||
        n.includes('node_modules/') ||
        n.includes('/produtos/')
);
console.log('Entradas:', names.length);
console.log('Sensíveis:', bad.length ? bad : 'nenhuma');
console.log('Tem README:', names.some((n) => n.includes('README.md')));
console.log('Tem .env.example:', names.some((n) => n.endsWith('.env.example')));
