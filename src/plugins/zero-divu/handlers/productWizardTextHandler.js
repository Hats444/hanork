'use strict';

const ProductWizardService = require('../../services/ProductWizardService');

/**
 * Wizard /addproduto — prioridade alta (logo após edição de produto).
 * @returns {boolean}
 */
async function tryHandleProductWizardText(ctx, deps) {
    const { isAdmin, productWizard, wizardDeps, Msg } = deps;
    const uid = ctx.from?.id;
    if (!uid || !isAdmin(uid) || !productWizard.has(uid)) return false;

    const txt = String(ctx.message?.text || '').trim();
    const wiz = productWizard.get(uid);

    if (txt === '/cancelar' || txt.toLowerCase() === 'cancelar') {
        ProductWizardService.clearWizard(productWizard, uid);
        await Msg.reply(ctx, '❌ Cadastro de produto cancelado.');
        return true;
    }

    const handled = await ProductWizardService.handleText(ctx, wiz, productWizard, wizardDeps());
    return !!handled;
}

module.exports = { tryHandleProductWizardText };
