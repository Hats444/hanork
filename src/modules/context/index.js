'use strict';

const IntentEngine = require('./IntentEngine');
const OperationalParser = require('./OperationalParser');
const EntityExtractor = require('./EntityExtractor');
const IntentClassifier = require('./IntentClassifier');
const ConfidenceScorer = require('./ConfidenceScorer');
const ContextMiddleware = require('./ContextMiddleware');
const { INTENT_TYPES, DEFAULT_THRESHOLDS } = require('./IntentTypes');

module.exports = {
    IntentEngine,
    OperationalParser,
    EntityExtractor,
    IntentClassifier,
    ConfidenceScorer,
    INTENT_TYPES,
    DEFAULT_THRESHOLDS,
    ...ContextMiddleware,
};
