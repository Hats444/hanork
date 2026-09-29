/**
 * Core Module - Sistema centralizado de callbacks
 * 
 * Exporta:
 * - CallbackRegistry: Registro e dispatch de callbacks
 * - UserHandlers: Implementação de todos os handlers
 * - ErrorHandler: Tratamento global de erros
 * - CallbackDispatcher: Integração com Telegraf
 */

'use strict';

const { CallbackRegistry, registry, Namespaces } = require('./CallbackRegistry');
const { UserHandlers, AllHandlers, LegacyMapping, UX } = require('./UserHandlers');
const { ErrorHandler, errorHandler } = require('./ErrorHandler');
const { CallbackDispatcher, dispatcher } = require('./CallbackDispatcher');

module.exports = {
    // Registry
    CallbackRegistry,
    registry,
    Namespaces,
    
    // Handlers
    UserHandlers,
    AllHandlers,
    LegacyMapping,
    UX,
    
    // Error Handling
    ErrorHandler,
    errorHandler,
    
    // Dispatcher
    CallbackDispatcher,
    dispatcher
};
