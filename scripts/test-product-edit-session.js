'use strict';

const assert = require('assert');
const {
    formatProductSessionDiscardedNote,
    appendProductSessionDiscardedNote,
} = require('../src/services/ProductAdminSession');
const ProductWizardService = require('../src/services/ProductWizardService');

function clearProductWizardState(store, adminId) {
    ProductWizardService.clearWizard(store, adminId);
}

async function simulateClearAll(store, editSessions, adminId) {
    const hadWizard = store.has(adminId);
    const hadEdit = editSessions.has(adminId);
    if (hadWizard) clearProductWizardState(store, adminId);
    if (hadEdit) editSessions.delete(adminId);
    return { wizard: hadWizard, edit: hadEdit };
}

assert.strictEqual(formatProductSessionDiscardedNote({ wizard: false, edit: false }), '');
assert.ok(formatProductSessionDiscardedNote({ wizard: true, edit: false }).includes('Cadastro'));
assert.ok(formatProductSessionDiscardedNote({ wizard: false, edit: true }).includes('Edição'));
assert.ok(formatProductSessionDiscardedNote({ wizard: true, edit: true }).includes('Cadastro'));

const withNote = appendProductSessionDiscardedNote('Olá', { wizard: true, edit: false });
assert.ok(withNote.startsWith('Olá'));
assert.ok(withNote.includes('Cadastro'));

const productWizard = new Map();
const editSessions = new Map();
ProductWizardService.startWizard(productWizard, 1);
editSessions.set(2, { pid: 5, field: 'desc' });

(async () => {
    assert.deepStrictEqual(await simulateClearAll(productWizard, editSessions, 1), { wizard: true, edit: false });
    assert.deepStrictEqual(await simulateClearAll(productWizard, editSessions, 2), { wizard: false, edit: true });
    assert.deepStrictEqual(await simulateClearAll(productWizard, editSessions, 99), { wizard: false, edit: false });

    console.log('test-product-edit-session: OK');
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
