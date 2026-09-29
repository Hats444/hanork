/**
 * CorrelationContext — Rastreamento de requisições
 * 
 * Fornece correlation IDs para tracing de requisições
 * através de múltiplos serviços e camadas.
 * 
 * Uso:
 *   const cid = CorrelationContext.getId();
 *   logger.info('Processing', { correlationId: cid });
 */

const { AsyncLocalStorage } = require('async_hooks');
const { randomUUID } = require('crypto');

// Fallback se randomUUID não disponível (Node <14.17)
const uuidv4 = () => {
    try {
        return randomUUID();
    } catch {
        return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
};

class CorrelationContext {
    constructor() {
        this.storage = new AsyncLocalStorage();
    }

    /**
     * Middleware Express — injeta correlation ID no request
     */
    middleware() {
        return (req, res, next) => {
            const correlationId = req.headers['x-correlation-id'] ||
                req.headers['x-request-id'] ||
                uuidv4();

            // Adicionar aos headers de resposta
            res.setHeader('x-correlation-id', correlationId);

            // Executar request no contexto
            this.storage.run({ correlationId, startTime: Date.now() }, () => {
                next();
            });
        };
    }

    /**
     * Middleware Telegraf — injeta correlation ID no contexto
     */
    telegrafMiddleware() {
        return async (ctx, next) => {
            const correlationId = `tg-${ctx.update.update_id}-${Date.now()}`;

            ctx.correlationId = correlationId;

            return this.storage.run({
                correlationId,
                userId: ctx.from?.id,
                chatId: ctx.chat?.id,
                startTime: Date.now()
            }, () => next());
        };
    }

    /**
     * Obter correlation ID do contexto atual
     */
    getId() {
        const store = this.storage.getStore();
        return store?.correlationId || null;
    }

    /**
     * Obter metadados completos do contexto
     */
    getMetadata() {
        const store = this.storage.getStore();
        if (!store) return null;

        return {
            ...store,
            duration: Date.now() - store.startTime
        };
    }

    /**
     * Executar função com um correlation ID específico
     */
    runWithId(fn, id = null) {
        const correlationId = id || uuidv4();
        return this.storage.run({ correlationId, startTime: Date.now() }, fn);
    }
}

module.exports = new CorrelationContext();
