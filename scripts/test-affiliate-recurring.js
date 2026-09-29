'use strict';

const assert = (cond, msg) => {
    if (!cond) throw new Error(msg);
};

const { buildShareInvitePlainText, buildSharePanelText, buildAffiliatePanelText } = require('../src/modules/affiliate/AffiliatePanels');

const shareText = buildShareInvitePlainText();
assert(!shareText.includes('https://'), 'texto de share não repete URL');
assert(shareText.includes('Hanork'), 'texto de share menciona a loja');

const aff = { code: 'AFF550156', referred_count: 3, sales_count: 5, earnings: 42.5 };
const panel = buildAffiliatePanelText(aff, 'hanork_bot');
assert(!panel.includes('primeira compra'), 'painel não fala só primeira compra');
assert(panel.includes('cada compra'), 'painel menciona cada compra');

const sharePanel = buildSharePanelText(aff, 'hanork_bot');
assert(sharePanel.includes('todas as compras'), 'painel compartilhar menciona todas as compras');

console.log('RESULT: OK');
