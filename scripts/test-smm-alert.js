'use strict';

const assert = require('assert');
const {
    buildAdminAlertHtml,
    buildUserFailureMessage,
    buildUserTerminalMessage,
    supportTicketHint,
} = require('../src/modules/smm/services/smmAlertService');
const { orderIssueNoticeKeyboard } = require('../src/modules/smm/keyboards/smmNoticeKeyboards');

const smmOrder = {
    id: 42,
    telegram_id: 123456789,
    quantity: 100,
    sale_price: 1.23,
    link: 'https://instagram.com/test',
};

const service = {
    id: 7,
    name: 'Instagram Seguidores BR',
    subcategory: 'seguidores',
};

const hanorkOrderId = '09fafede-3cdb-496c-8faf-2210463245b8';

const adminHtml = buildAdminAlertHtml({
    reason: 'insufficient_provider_balance',
    hanorkOrderId,
    smmOrder,
    service,
    detail: 'balance=39 required=99.9',
});
assert(adminHtml.includes('Saldo insuficiente'), 'admin label');
assert(adminHtml.includes('2210463245b8'.slice(-8)) || adminHtml.includes('#'), 'order ref');
assert(adminHtml.includes('123456789'), 'client id');

const userMsg = buildUserFailureMessage({
    reason: 'provider_rejected',
    hanorkOrderId,
    smmOrder,
});
assert(userMsg.includes('Abrir ticket') || userMsg.includes('/suporte'), 'support hint');
assert(userMsg.includes('Precisa de ajuda'), 'help section');

const failedMsg = buildUserTerminalMessage(
    { ...smmOrder, hanork_order_id: hanorkOrderId },
    'failed'
);
assert(failedMsg.includes('falha'), 'failed terminal');
assert(failedMsg.includes(supportTicketHint('#').includes('ticket') ? 'ticket' : 'suporte'), 'ticket in terminal');

const kb = orderIssueNoticeKeyboard(42, 7);
const flat = JSON.stringify(kb.reply_markup || kb);
assert(flat.includes('hanork:ticket'), 'ticket button');
assert(flat.includes('smm:o:42'), 'order view button');

console.log('test-smm-alert.js OK');
