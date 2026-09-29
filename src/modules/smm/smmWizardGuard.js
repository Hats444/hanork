'use strict';

const Msg = require('../../telegram/Msg');

async function isSmmWizardActive(stateManager, telegramId) {
    if (!stateManager || telegramId == null) return false;
    try {
        const { isSmmEnabled } = require('./smmEnabled');
        if (!isSmmEnabled()) return false;
        const { hasActiveSmmWizard } = require('./handlers/smmWizardHandler');
        return hasActiveSmmWizard(stateManager, telegramId);
    } catch {
        return false;
    }
}

/**
 * Wizard SMM ativo — outros fluxos (router, downloads, bridge) devem ceder.
 */
async function smmWizardOwnsFlow(ctx, stateManager) {
    if (ctx.state?.smmWizardActive) return true;
    return isSmmWizardActive(stateManager, ctx.from?.id);
}

/** @deprecated use smmWizardOwnsFlow */
async function shouldBlockHanorkIntent(ctx, stateManager) {
    return smmWizardOwnsFlow(ctx, stateManager);
}

/**
 * Tenta consumir texto do wizard SMM. Se ativo, marca ctx para bloquear Intent AI / downloads.
 * @returns {boolean} true se a mensagem foi totalmente tratada
 */
async function tryHandleSmmWizardText(ctx, stateManager) {
    const uid = ctx.from?.id;
    if (!uid || ctx.chat?.type !== 'private') return false;

    const active = await isSmmWizardActive(stateManager, uid);
    if (!active) return false;

    const { handleWizardText } = require('./handlers/smmWizardHandler');
    const handled = await handleWizardText(ctx, Msg, stateManager, ctx.message?.text);
    if (handled) return true;

    ctx.state = ctx.state || {};
    ctx.state.smmWizardActive = true;
    return false;
}

/**
 * bot.hears de downloads — não baixar quando wizard SMM está ativo.
 * Tenta consumir o texto no wizard (ex.: link Instagram no passo link).
 * @returns {boolean} true se o handler de download deve abortar
 */
async function blockDownloadForSmmWizard(ctx, stateManager) {
    if (!(await smmWizardOwnsFlow(ctx, stateManager))) return false;
    await tryHandleSmmWizardText(ctx, stateManager);
    return true;
}

/** @deprecated use blockDownloadForSmmWizard */
async function yieldDownloadHearsToSmmWizard(ctx, stateManager, next) {
    if (await blockDownloadForSmmWizard(ctx, stateManager)) return true;
    return false;
}

module.exports = {
    isSmmWizardActive,
    smmWizardOwnsFlow,
    shouldBlockHanorkIntent,
    tryHandleSmmWizardText,
    blockDownloadForSmmWizard,
    yieldDownloadHearsToSmmWizard,
};
