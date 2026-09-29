'use strict';

const assert = (cond, msg) => {
    if (!cond) throw new Error(msg);
};

const { DB_FIELD_MAP } = require('../src/telegram/handlers/productEditTextHandler');

assert(DB_FIELD_MAP.name === 'name', 'name field');
assert(DB_FIELD_MAP.desc === 'description', 'desc maps to description');
assert(DB_FIELD_MAP.file === 'file_url', 'file maps to file_url');
assert(DB_FIELD_MAP.photo === 'photo', 'photo field');

const { isAdminInProductAdminFlow } = require('../src/telegram/handlers/productAdminFlowGuard');
(async () => {
    assert((await isAdminInProductAdminFlow(null, {})) === false, 'null uid');
    const wiz = { has: (id) => id === 1 };
    assert((await isAdminInProductAdminFlow(1, { productWizard: wiz })) === true, 'wizard flow');
})().then(() => {
    console.log('=== Product Edit Text Handler ===');
    console.log('RESULT: OK');
});
