'use strict';

const { DEFAULT_THRESHOLDS } = require('./IntentTypes');

function getThresholds() {
    const execute = parseFloat(process.env.CONTEXT_MIN_CONFIDENCE_EXECUTE || DEFAULT_THRESHOLDS.execute);
    const suggest = parseFloat(process.env.CONTEXT_MIN_CONFIDENCE_SUGGEST || DEFAULT_THRESHOLDS.suggest);
    const ignore = parseFloat(process.env.CONTEXT_MIN_CONFIDENCE_IGNORE || DEFAULT_THRESHOLDS.ignore);
    return { execute, suggest, ignore };
}

/**
 * @param {{ classifierScore: number, entities: object, hasContextRef?: boolean }} input
 */
function score(input) {
    const { classifierScore, entities, hasContextRef } = input;
    let c = classifierScore || 0;

    if (entities.amount != null) c += 0.04;
    if (entities.client) c += 0.05;
    if (entities.method) c += 0.02;
    if (entities.service) c += 0.03;
    if (entities.date || entities.time) c += 0.03;
    if (hasContextRef && entities.client) c += 0.06;

    c = Math.min(Math.max(c, 0), 0.99);

    const thresholds = getThresholds();
    let action = 'ignore';
    if (c >= thresholds.execute) action = 'execute';
    else if (c >= thresholds.suggest) action = 'suggest';

    return { confidence: c, action, thresholds };
}

module.exports = { score, getThresholds };
