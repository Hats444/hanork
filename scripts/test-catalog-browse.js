#!/usr/bin/env node
'use strict';

const assert = require('assert');
const catalogBrowse = require('../src/utils/catalogBrowse');

function test(name, fn) {
    try {
        fn();
        console.log(`  ✓ ${name}`);
    } catch (e) {
        console.error(`  ✗ ${name}: ${e.message}`);
        process.exitCode = 1;
    }
}

const sample = [
    { id: 3, name: 'Pack ZIP', price: 30, file_url: 'a.zip' },
    { id: 2, name: 'Foto HD', price: 10, file_url: 'b.jpg' },
    { id: 1, name: 'Curso', price: 50, file_url: 'c.pdf' },
];

console.log('\n=== Hanork — testes catalogBrowse ===\n');

test('agrupa formatos', () => {
    const g = catalogBrowse.groupProductsByFormat(sample);
    assert.ok(Object.keys(g).length >= 2);
    const zipKey = Object.keys(g).find((k) => k.includes('zip') || k === 'zip');
    const imgKey = Object.keys(g).find((k) => k.includes('jpg') || k === 'fotos' || k === 'jpg');
    assert.ok(zipKey && g[zipKey].length === 1);
    assert.ok(imgKey && g[imgKey].length === 1);
});

test('ordena preço asc', () => {
    const s = catalogBrowse.sortProducts(sample, 'asc');
    assert.strictEqual(s[0].price, 10);
});

test('busca por nome', () => {
    const f = catalogBrowse.filterBySearch(sample, 'pack');
    assert.strictEqual(f.length, 1);
});

test('parse list callback com sort', () => {
    const p = catalogBrowse.parseListCallback('cat_list_2_desc');
    assert.strictEqual(p.page, 2);
    assert.strictEqual(p.sort, 'desc');
});

if (process.exitCode) process.exit(1);
console.log('\nOK\n');
