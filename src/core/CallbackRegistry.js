/**
 * CallbackRegistry - Sistema Centralizado de Callbacks
 * 
 * Arquitetura:
 * - Namespaces consistentes
 * - Registro declarativo
 * - Dispatcher centralizado
 * - Middleware de auditoria
 * - Fallback handler
 * - Logging estruturado
 */

'use strict';

const logger = require('../config/logger');
const correlationContext = require('../infrastructure/CorrelationContext');

/**
 * Namespaces de Callbacks (padronizados)
 * 
 * menu:*      - Navegação de menus
 * cart:*      - Operações de carrinho
 * product:*   - Visualização de produtos
 * payment:*   - Fluxo de pagamento
 * user:*      - Área do usuário
 * order:*     - Pedidos e rastreamento
 * search:*    - Busca
 * help:*      - Ajuda e suporte
 * admin:*     - Painel admin (mantido para compatibilidade)
 * flash:*     - Vendas relâmpago
 * affiliate:* - Sistema de afiliados
 * noop:*      - Operações inválidas
 */
const Namespaces = {
    MENU: 'menu',
    CART: 'cart',
    PRODUCT: 'product',
    PAYMENT: 'payment',
    USER: 'user',
    ORDER: 'order',
    SEARCH: 'search',
    HELP: 'help',
    ADMIN: 'admin',
    FLASH: 'flash',
    AFFILIATE: 'affiliate',
    NOOP: 'noop',
    DEV: 'dev' // Funcionalidade em desenvolvimento
};

/**
 * Padrões de Callback Válidos
 * Formato: namespace:action[:param]
 */
const VALID_CALLBACK_PATTERN = /^[a-z_]+:[a-z_]+(:[^\s]+)?$/;

class CallbackRegistry {
    constructor() {
        this.handlers = new Map();
        this.middlewares = [];
        this.fallbackHandler = null;
        this.stats = {
            registered: 0,
            dispatched: 0,
            errors: 0,
            unknown: 0
        };
    }

    /**
     * Registra um handler para um callback
     * @param {string} pattern - Padrão do callback (ex: 'menu:home', 'cart:add:*')
     * @param {Function} handler - Handler async (ctx, params) => {}
     * @param {Object} options - Opções
     * @param {boolean} options.requireAdmin - Requer admin
     * @param {boolean} options.requirePrivate - Requer chat privado
     * @param {string} options.description - Descrição para documentação
     * @param {number} options.rateLimit - Limite de requisições/min
     */
    register(pattern, handler, options = {}) {
        if (typeof handler !== 'function') {
            throw new Error(`Handler for ${pattern} must be a function`);
        }

        // Validar padrão (aliases legados não geram ruído no log)
        const skipConventionWarn =
            options.legacyAlias ||
            options.skipConventionWarn ||
            pattern === 'noop';
        if (
            !skipConventionWarn &&
            !VALID_CALLBACK_PATTERN.test(pattern) &&
            !pattern.includes('*')
        ) {
            logger.warn(`[CallbackRegistry] Pattern ${pattern} não segue convenção namespace:action`);
        }

        this.handlers.set(pattern, {
            handler,
            options,
            registeredAt: new Date().toISOString()
        });
        
        this.stats.registered++;
        logger.debug(`[CallbackRegistry] Registered: ${pattern}`);
    }

    /**
     * Registra múltiplos handlers
     * @param {Object} handlers - Mapa de padrão -> handler
     */
    registerMany(handlers) {
        for (const [pattern, config] of Object.entries(handlers)) {
            if (typeof config === 'function') {
                this.register(pattern, config);
            } else {
                this.register(pattern, config.handler, config.options);
            }
        }
    }

    /**
     * Adiciona middleware global
     * @param {Function} middleware - (ctx, next) => {}
     */
    use(middleware) {
        this.middlewares.push(middleware);
    }

    /**
     * Define handler para callbacks desconhecidos
     * @param {Function} handler - Handler de fallback
     */
    setFallback(handler) {
        this.fallbackHandler = handler;
    }

    /**
     * Dispatch um callback
     * @param {Object} ctx - Contexto Telegraf
     * @returns {Promise<boolean>} - true se handler encontrado e executado
     */
    async dispatch(ctx) {
        const data = ctx.callbackQuery?.data;
        const userId = ctx.from?.id;
        const chatId = ctx.chat?.id;

        if (!data) {
            logger.warn('[CallbackRegistry] Callback sem data', { userId, chatId });
            return false;
        }

        this.stats.dispatched++;

        // Log estruturado
        const logContext = {
            callback: data,
            userId,
            chatId,
            correlationId: correlationContext.getId() || ctx.correlationId || null,
            timestamp: new Date().toISOString(),
        };

        try {
            // Executar middlewares
            for (const middleware of this.middlewares) {
                const result = await middleware(ctx, () => Promise.resolve(true));
                if (result === false) {
                    logger.info('[CallbackRegistry] Middleware blocked', logContext);
                    return false;
                }
            }

            // Encontrar handler
            const { pattern, params, handler: resolvedHandler, options } = this._resolveHandler(data);

            if (!resolvedHandler) {
                this.stats.unknown++;
                logger.warn('[CallbackRegistry] Unknown callback', logContext);
                
                if (this.fallbackHandler) {
                    await this.fallbackHandler(ctx, data);
                }
                return false;
            }

            // Verificar permissões
            if (options.requireAdmin && !ctx.isAdmin?.(userId)) {
                const { denySilent } = require('../utils/silencedAccess');
                denySilent('callback_registry', ctx, { pattern: data });
                return false;
            }

            if (options.requirePrivate && ctx.chat?.type !== 'private') {
                await ctx.answerCbQuery('👤 Use no privado');
                return false;
            }

            // Executar handler
            logger.info('[CallbackRegistry] Executing', { ...logContext, pattern, options });
            
            const startTime = Date.now();
            await resolvedHandler(ctx, params);
            const duration = Date.now() - startTime;

            logger.info('[CallbackRegistry] Completed', { 
                ...logContext, 
                pattern, 
                durationMs: duration 
            });

            return true;

        } catch (error) {
            this.stats.errors++;
            logger.error('[CallbackRegistry] Handler error', {
                ...logContext,
                error: error.message,
                stack: error.stack,
                pattern: data
            });

            // Notificar usuário de erro
            try {
                await ctx.answerCbQuery('❌ Erro ao processar');
            } catch (e) {
                // Ignorar erro ao responder
            }

            throw error; // Re-lançar para tratamento global
        }
    }

    /**
     * Resolve handler para um callback data
     * @private
     */
    _resolveHandler(data) {
        // Tentar match exato
        if (this.handlers.has(data)) {
            const { handler, options } = this.handlers.get(data);
            return { pattern: data, params: null, handler, options };
        }

        // Tentar match de padrão com wildcard
        for (const [pattern, config] of this.handlers.entries()) {
            if (pattern.includes('*')) {
                const regex = new RegExp('^' + pattern.replace(/\*/g, '([^:]+)') + '$');
                const match = data.match(regex);
                if (match) {
                    return { 
                        pattern, 
                        params: match.slice(1), 
                        handler: config.handler, 
                        options: config.options 
                    };
                }
            }
        }

        // Tentar parse como namespace:action:param
        const parts = data.split(':');
        if (parts.length >= 2) {
            const basePattern = `${parts[0]}:${parts[1]}:*`;
            if (this.handlers.has(basePattern)) {
                const { handler, options } = this.handlers.get(basePattern);
                return { 
                    pattern: basePattern, 
                    params: parts.slice(2), 
                    handler, 
                    options 
                };
            }
        }

        return { pattern: null, params: null, handler: null, options: null };
    }

    /**
     * Resolve handler/descrição para um callback (uso em notificações admin)
     */
    resolve(data) {
        return this._resolveHandler(String(data || ''));
    }

    /**
     * Lista todos os callbacks registrados
     */
    list() {
        const result = {};
        for (const [pattern, config] of this.handlers.entries()) {
            result[pattern] = {
                hasOptions: Object.keys(config.options).length > 0,
                description: config.options.description || 'Sem descrição',
                registeredAt: config.registeredAt
            };
        }
        return result;
    }

    /**
     * Retorna estatísticas
     */
    getStats() {
        return { ...this.stats };
    }

    /**
     * Limpa todos os handlers (útil para testes)
     */
    clear() {
        this.handlers.clear();
        this.middlewares = [];
        this.stats = { registered: 0, dispatched: 0, errors: 0, unknown: 0 };
    }
}

// Singleton instance
const registry = new CallbackRegistry();

module.exports = {
    CallbackRegistry,
    registry,
    Namespaces,
    VALID_CALLBACK_PATTERN
};
