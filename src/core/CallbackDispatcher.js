/**
 * CallbackDispatcher - Integração entre CallbackRegistry e UserHandlers
 * 
 * Responsabilidades:
 * - Registrar todos os handlers no registry
 * - Configurar middlewares globais
 * - Mapear callbacks antigos para novos
 * - Integrar com bot.js
 */

'use strict';

const { registry } = require('./CallbackRegistry');
const { AllHandlers, LegacyMapping } = require('./UserHandlers');
const { errorHandler } = require('./ErrorHandler');
const logger = require('../config/logger');

class CallbackDispatcher {
    constructor() {
        this.initialized = false;
        this.stats = {
            handlersRegistered: 0,
            legacyCallbacksMapped: 0,
            middlewaresAdded: 0
        };
    }

    /**
     * Inicializa o sistema de callbacks
     * @param {Object} bot - Instância do Telegraf
     */
    initialize(bot) {
        if (this.initialized) {
            logger.warn('[CallbackDispatcher] Already initialized');
            return;
        }

        logger.info('[CallbackDispatcher] Initializing...');

        // 1. Adicionar middleware de erro global
        this._setupErrorMiddleware(bot);

        // 2. Adicionar middleware de auditoria
        this._setupAuditMiddleware();

        // 3. Registrar todos os handlers
        this._registerAllHandlers();

        // 4. Configurar handler de fallback
        this._setupFallbackHandler();

        // 5. Integrar com bot.on('callback_query')
        this._integrateWithBot(bot);

        this.initialized = true;

        logger.info('[CallbackDispatcher] Initialized', {
            handlers: this.stats.handlersRegistered,
            legacyMapped: this.stats.legacyCallbacksMapped
        });
    }

    /**
     * Configura middleware de erro
     */
    _setupErrorMiddleware(bot) {
        // Usar errorHandler global
        bot.use(errorHandler.globalErrorHandler());
        this.stats.middlewaresAdded++;

        logger.info('[CallbackDispatcher] Error middleware added');
    }

    /**
     * Configura middleware de auditoria
     */
    _setupAuditMiddleware() {
        registry.use(async (ctx, next) => {
            const startTime = Date.now();
            const callbackData = ctx.callbackQuery?.data;

            logger.debug('[CallbackDispatcher] Processing callback', {
                data: callbackData,
                userId: ctx.from?.id
            });

            const result = await next();

            const duration = Date.now() - startTime;
            logger.debug('[CallbackDispatcher] Callback processed', {
                data: callbackData,
                durationMs: duration,
                success: result
            });

            return result;
        });

        this.stats.middlewaresAdded++;
    }

    /**
     * Registra todos os handlers no registry
     */
    _registerAllHandlers() {
        // Registrar handlers novos (namespace format)
        for (const [pattern, handler] of Object.entries(AllHandlers)) {
            registry.register(pattern, handler, {
                description: `Handler for ${pattern}`
            });
            this.stats.handlersRegistered++;
        }

        // Registrar mapeamentos de legacy (callbacks antigos)
        for (const [legacyPattern, newPattern] of Object.entries(LegacyMapping)) {
            // Criar handler que delega para o novo
            const delegateHandler = async (ctx) => {
                logger.info('[CallbackDispatcher] Legacy callback redirected', {
                    from: legacyPattern,
                    to: newPattern,
                    userId: ctx.from?.id
                });

                // Atualizar callback data no contexto
                ctx.callbackQuery.data = newPattern;

                // Re-executar dispatch com novo pattern
                return registry.dispatch(ctx);
            };

            registry.register(legacyPattern, delegateHandler, {
                description: `Legacy redirect to ${newPattern}`,
                isLegacy: true
            });

            this.stats.legacyCallbacksMapped++;
        }

        logger.info('[CallbackDispatcher] Handlers registered', {
            new: Object.keys(AllHandlers).length,
            legacy: Object.keys(LegacyMapping).length
        });
    }

    /**
     * Configura handler de fallback
     */
    _setupFallbackHandler() {
        registry.setFallback(async (ctx, unknownData) => {
            logger.warn('[CallbackDispatcher] Unknown callback', {
                data: unknownData,
                userId: ctx.from?.id
            });

            await ctx.answerCbQuery('❌ Ação não reconhecida');

            // Tent mostrar mensagem explicativa
            try {
                const Msg = require('../telegram/Msg');
                const { Markup } = require('telegraf');
                await Msg.reply(
                    ctx,
                    '❌ Esta ação não está disponível no momento.\n\nUse /start para reiniciar o bot.',
                    Markup.inlineKeyboard([[{ text: '🏠 Menu', callback_data: 'menu:home' }]])
                );
            } catch (e) {
                // Ignorar erro ao enviar mensagem
            }
        });
    }

    /**
     * Integra com o bot.on('callback_query')
     * NOTA: O bot.js já possui handler global que delega para registry.dispatch.
     * Este método está desativado para evitar duplicação.
     */
    _integrateWithBot(bot) {
        // Handler de callback_query já gerenciado pelo bot.js
        // O registry.dispatch é chamado diretamente no handler global
        logger.info('[CallbackDispatcher] Integration skipped — bot.js handles callback_query');
    }

    /**
     * Retorna estatísticas
     */
    getStats() {
        return {
            ...this.stats,
            registryStats: registry.getStats(),
            initialized: this.initialized
        };
    }

    /**
     * Lista todos os callbacks registrados
     */
    listCallbacks() {
        return registry.list();
    }
}

// Singleton
const dispatcher = new CallbackDispatcher();

module.exports = {
    CallbackDispatcher,
    dispatcher
};
