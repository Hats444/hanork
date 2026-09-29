'use strict';

const logger = require('../../config/logger');

const log = logger.child({ category: 'CONTEXT', module: 'OperationalIntelligence' });

function intentDetected(payload) {
    log.info('intent detectada', payload);
}

function confidenceScore(payload) {
    log.debug('score confiança', payload);
}

function entitiesExtracted(payload) {
    log.debug('entities extraídas', payload);
}

function parseTiming(payload) {
    log.debug('tempo parsing', payload);
}

function actionExecuted(payload) {
    log.info('ação executada', payload);
}

function parseError(err, payload) {
    log.warn('erro parsing', { error: err?.message, ...payload });
}

function ignored(payload) {
    log.debug('mensagem ignorada', payload);
}

module.exports = {
    log,
    intentDetected,
    confidenceScore,
    entitiesExtracted,
    parseTiming,
    actionExecuted,
    parseError,
    ignored,
};
