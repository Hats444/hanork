'use strict';

const { registerHelpCommands } = require('./helpCommands');
const { registerShopCommands } = require('./shopCommands');
const { registerAccountCommands } = require('./accountCommands');
const { registerSupportCommands } = require('./supportCommands');
const { registerUserOnboardingHandlers } = require('./onboardingHandlers');
const { registerOrderFeedbackHandlers } = require('./orderFeedbackHandlers');
const { registerTermsHandlers } = require('./termsHandlers');

/**
 * M3/B3 — comandos de usuário extraídos de bot.js
 */
function registerUserCommands(bot, deps) {
    const help = registerHelpCommands(bot, deps);
    registerShopCommands(bot, deps);
    registerAccountCommands(bot, deps);
    registerSupportCommands(bot, deps);
    const onboarding = registerUserOnboardingHandlers(bot, deps);
    registerOrderFeedbackHandlers(bot, deps);
    const terms = registerTermsHandlers(bot, deps);

    try {
        const { registerWaDivulgacaoCommands } = require('../../../modules/wa-divulgacao/commands/registerWaDivulgacaoCommands');
        registerWaDivulgacaoCommands(bot, deps);
    } catch (_) { /* optional */ }

    return { ...help, ...onboarding, ...terms };
}

module.exports = { registerUserCommands };
