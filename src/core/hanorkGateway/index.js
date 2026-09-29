'use strict';

/**
 * Hanork Gateway — B2 Unified Router.
 * U2: telemetria + predição (padrão).
 * U3: legacy WARN + gate legacyOffReady (telemetria <1%).
 * U4: ActionRegistry — NL planner consome fonte única.
 */
const config = require('./config');
const intentResolver = require('./intentResolver');
const routeTelemetry = require('./routeTelemetry');
const { dispatchCallbackQuery } = require('./callbackDispatch');
const gatewayMiddleware = require('./gatewayMiddleware');
const ActionRegistry = require('./ActionRegistry');
const legacyDeprecation = require('./legacyDeprecation');

function predictCallbackRoute(rawData, registry) {
    return intentResolver.predictCallbackRoute(rawData, registry);
}

module.exports = {
    ...config,
    ...intentResolver,
    ...routeTelemetry,
    ...gatewayMiddleware,
    ...ActionRegistry,
    ...legacyDeprecation,
    dispatchCallbackQuery,
    predictCallbackRoute,
    ActionRegistry,
};
