'use strict';

const assert = (cond, msg) => {
    if (!cond) throw new Error(msg);
};

const fs = require('fs');

const msgSrc = fs.readFileSync(require.resolve('../src/telegram/Msg.js'), 'utf8');
assert(msgSrc.includes('isPvPanel'), 'editCallbackPanel deve forçar foto no PV com teclado');
assert(msgSrc.includes('hasInlineKeyboard(markup) && !hasExplicitPhoto'), 'guard PV panel');

const userSrc = fs.readFileSync(require.resolve('../src/core/UserHandlers.js'), 'utf8');
assert(!userSrc.includes('skipMenuPhoto: true'), 'UserHandlers sem skipMenuPhoto em painéis');
assert(!userSrc.includes('uiRespondPanel'), 'UserHandlers sem uiRespondPanel');

console.log('RESULT: OK');
