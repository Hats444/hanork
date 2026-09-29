'use strict';

/**
 * Dispatch unificado de callback_query — mesma ordem que router.js (B2).
 */
const { errorHandler } = require('../ErrorHandler');
const {
    normalizeCallbackData,
    delegatePaymentNamespaceToLegacy,
    shouldDelegateToLegacyBotAction,
} = require('../../telegram/callbacks/legacyPatterns');
const intentResolver = require('./intentResolver');
const routeTelemetry = require('./routeTelemetry');
const legacyDeprecation = require('./legacyDeprecation');

/**
 * @param {import('telegraf').Context} ctx
 * @param {Function} next
 * @param {{ registry: object, ready?: boolean }} opts
 */
async function dispatchCallbackQuery(ctx, next, { registry, ready = true } = {}) {
    if (!ctx.callbackQuery?.data) {
        return next();
    }
    if (!ready) {
        return next();
    }

    const raw = ctx.callbackQuery.data;
    const prediction = intentResolver.predictCallbackRoute(raw, registry);
    const n = normalizeCallbackData(raw);
    if (n && n !== raw) ctx.callbackQuery.data = n;

    const legacyPay = delegatePaymentNamespaceToLegacy(ctx.callbackQuery.data);
    if (legacyPay) {
        ctx.callbackQuery.data = legacyPay;
        routeTelemetry.recordCallbackRoute('legacy_payment', raw, prediction);
        legacyDeprecation.warnLegacyRoute('legacy_payment', raw);
        legacyDeprecation.maybeLogPeriodicSummary();
        return next();
    }

    if (shouldDelegateToLegacyBotAction(ctx.callbackQuery.data)) {
        routeTelemetry.recordCallbackRoute('legacy', raw, prediction);
        legacyDeprecation.warnLegacyRoute('legacy', raw);
        legacyDeprecation.maybeLogPeriodicSummary();
        return next();
    }

    try {
        const handled = await registry.dispatch(ctx);
        if (handled) {
            routeTelemetry.recordCallbackRoute('registry', raw, prediction);
            return;
        }
    } catch (e) {
        await errorHandler.handleCallbackError(ctx, e);
        routeTelemetry.recordCallbackRoute('registry', raw, prediction);
        return;
    }

    routeTelemetry.recordCallbackRoute('legacy_action', raw, prediction);
    legacyDeprecation.warnLegacyRoute('legacy_action', raw);
    legacyDeprecation.maybeLogPeriodicSummary();
    return next();
}

module.exports = { dispatchCallbackQuery };
