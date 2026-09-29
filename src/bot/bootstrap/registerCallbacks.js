'use strict';

const { setupCallbackSystem } = require('../../telegram/callbacks/setup');

function registerCallbacks(bot, deps, adminIds) {
    setupCallbackSystem(bot, deps, adminIds);
}

module.exports = { registerCallbacks };
