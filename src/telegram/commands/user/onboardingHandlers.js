'use strict';

const { registerWelcomeTourHandlers } = require('./userWelcomeTour');

/**
 * Tour de boas-vindas para novos usuários (ob_* callbacks).
 */
function registerUserOnboardingHandlers(bot, deps) {
    return registerWelcomeTourHandlers(bot, deps);
}

module.exports = { registerUserOnboardingHandlers };
