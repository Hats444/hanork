#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const deliveryService = require('../src/modules/delivery/DeliveryService');

let failed = 0;
function test(name, fn) {
    return (async () => {
        try {
            await fn();
            console.log('  OK', name);
        } catch (e) {
            failed++;
            console.error('  FAIL', name + ':', e.message);
        }
    })();
}

function createMockTelegram() {
    const calls = [];
    return {
        calls,
        async sendMessage(chatId, text, opts) {
            calls.push({ type: 'message', chatId, text, opts });
        },
        async sendDocument(chatId, doc, opts) {
            calls.push({ type: 'document', chatId, doc, opts });
        },
    };
}

const productsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hanork-delivery-'));
const savedProductsPath = process.env.PRODUCTS_PATH;
process.env.PRODUCTS_PATH = productsDir;

const sampleFile = path.join(productsDir, 'ebook.pdf');
fs.writeFileSync(sampleFile, '%PDF-test');

console.log('\n=== Delivery (_deliverItem) ===\n');

const tests = [];

tests.push(test('text: envia mensagem', async () => {
    const tg = createMockTelegram();
    const ok = await deliveryService._deliverItem(tg, 1, {
        name: 'Código',
        file_url: 'text:ABC-123',
    });
    assert.strictEqual(ok, true);
    assert.strictEqual(tg.calls.length, 1);
    assert.strictEqual(tg.calls[0].type, 'message');
    assert.ok(tg.calls[0].text.includes('ABC-123'));
}));

tests.push(test('content direto', async () => {
    const tg = createMockTelegram();
    const ok = await deliveryService._deliverItem(tg, 2, {
        name: 'Serial',
        content: 'KEY-999',
    });
    assert.strictEqual(ok, true);
    assert.ok(tg.calls[0].text.includes('KEY-999'));
}));

tests.push(test('arquivo local válido', async () => {
    const tg = createMockTelegram();
    const ok = await deliveryService._deliverItem(tg, 3, {
        name: 'Ebook',
        file_url: 'ebook.pdf',
    });
    assert.strictEqual(ok, true);
    assert.strictEqual(tg.calls[0].type, 'document');
    assert.strictEqual(tg.calls[0].doc.source, sampleFile);
}));

tests.push(test('path traversal não entrega arquivo', async () => {
    const outside = path.join(os.tmpdir(), 'hanork-secret-outside.txt');
    fs.writeFileSync(outside, 'secret');
    const tg = createMockTelegram();
    const ok = await deliveryService._deliverItem(tg, 4, {
        name: 'Hack',
        file_url: path.join('..', path.basename(outside)),
    });
    assert.strictEqual(ok, false);
    assert.strictEqual(tg.calls.length, 0);
    fs.unlinkSync(outside);
}));

tests.push(test('sem ref retorna false', async () => {
    const tg = createMockTelegram();
    const ok = await deliveryService._deliverItem(tg, 5, { name: 'Vazio' });
    assert.strictEqual(ok, false);
}));

Promise.all(tests).then(() => {
    if (savedProductsPath === undefined) delete process.env.PRODUCTS_PATH;
    else process.env.PRODUCTS_PATH = savedProductsPath;
    try {
        fs.rmSync(productsDir, { recursive: true, force: true });
    } catch {}

    console.log(failed ? `\n${failed} falha(s)\n` : '\nOK — delivery\n');
    process.exit(failed ? 1 : 0);
});
