'use strict';

const { registry } = require('../../core/CallbackRegistry');
const hanorkGateway = require('../../core/hanorkGateway');
const { dispatchCallbackQuery } = require('../../core/hanorkGateway/callbackDispatch');

let _ready = false;
let _guardBot = null;
let _guardIsAdmin = null;

function setCallbackRouterGroupGuard({ bot, isAdmin }) {
    _guardBot = bot;
    _guardIsAdmin = isAdmin;
}

function markCallbackRouterReady() {
    _ready = true;
}

/**
 * Middleware Telegraf — deve rodar cedo (após mainMiddleware), antes dos bot.action legados.
 * Omitido quando HANORK_GATEWAY=1 (gatewayMiddleware substitui).
 */
function createCallbackRouterMiddleware() {
    return async function callbackRouterMiddleware(ctx, next) {
        return dispatchCallbackQuery(ctx, next, { registry, ready: _ready });
    };
}

module.exports = {
    createCallbackRouterMiddleware,
    markCallbackRouterReady,
    setCallbackRouterGroupGuard,
};
