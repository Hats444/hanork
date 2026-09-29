'use strict';

/**
 * HanorkGateway — middleware B2 (HANORK_GATEWAY=1).
 * Entrada unificada: resolve intent + dispatch callback; slash/text seguem legado.
 */
const logger = require('../../config/logger');
const { registry } = require('../CallbackRegistry');
const { isFullGatewayEnabled } = require('./config');
const intentResolver = require('./intentResolver');
const { dispatchCallbackQuery } = require('./callbackDispatch');
const routeTelemetry = require('./routeTelemetry');

let _ready = false;

function markHanorkGatewayReady() {
    _ready = true;
}

function isHanorkGatewayReady() {
    return _ready;
}

function createHanorkGatewayMiddleware() {
    return async function hanorkGatewayMiddleware(ctx, next) {
        const intent = intentResolver.resolve(ctx, registry);
        if (intent) {
            ctx.hanorkIntent = intent;
            routeTelemetry.recordIntentResolve(intent);
        }

        if (ctx.callbackQuery?.data) {
            return dispatchCallbackQuery(ctx, next, { registry, ready: _ready });
        }

        return next();
    };
}

function logGatewayBoot() {
    if (!isFullGatewayEnabled()) return;
    const { isLegacyWarnEnabled } = require('./config');
    logger.info('[HanorkGateway] B2 gateway ATIVO (HANORK_GATEWAY=1)', {
        telemetry: true,
        mode: 'unified',
        legacyWarn: isLegacyWarnEnabled(),
        u3: 'deprecation-warn',
        u4: 'action-registry',
    });
}

module.exports = {
    createHanorkGatewayMiddleware,
    markHanorkGatewayReady,
    isHanorkGatewayReady,
    logGatewayBoot,
};
