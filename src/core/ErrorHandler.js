/**
 * ErrorHandler - Middleware global de tratamento de erros
 * 
 * Características:
 * - Captura todas as exceções
 * - Log estruturado com contexto completo
 * - Resposta amigável ao usuário
 * - Nunca silencia erros
 */

'use strict';

const Msg = require('../telegram/Msg');
const { Markup } = require('telegraf');
const logger = require('../config/logger');

class ErrorHandler {
    constructor() {
        this.errorCount = 0;
        this.recentErrors = []; // Últimos 100 erros para diagnóstico
    }

    /**
     * Middleware para capturar erros em callbacks
     */
    callbackErrorMiddleware() {
        return async (ctx, next) => {
            try {
                return await next();
            } catch (error) {
                await this.handleCallbackError(ctx, error);
            }
        };
    }

    /**
     * Trata erro em callback
     */
    async handleCallbackError(ctx, error) {
        this.errorCount++;
        
        const errorContext = {
            type: 'CALLBACK_ERROR',
            errorId: this._generateErrorId(),
            message: error.message,
            stack: error.stack,
            userId: ctx.from?.id,
            chatId: ctx.chat?.id,
            callbackData: ctx.callbackQuery?.data,
            messageId: ctx.callbackQuery?.message?.message_id,
            timestamp: new Date().toISOString()
        };

        // Armazenar para diagnóstico
        this.recentErrors.unshift(errorContext);
        if (this.recentErrors.length > 100) this.recentErrors.pop();

        // Log estruturado
        logger.error('[ErrorHandler] Callback error', errorContext);

        // Tentar responder ao usuário
        try {
            await this._notifyUser(ctx, errorContext);
        } catch (notifyError) {
            logger.error('[ErrorHandler] Failed to notify user', {
                originalError: error.message,
                notifyError: notifyError.message
            });
        }

        // Não propagar erro para não crashar o bot
        // Mas logar para análise
    }

    /**
     * Trata erro em comando
     */
    async handleCommandError(ctx, error, commandName) {
        this.errorCount++;

        const errorContext = {
            type: 'COMMAND_ERROR',
            errorId: this._generateErrorId(),
            command: commandName,
            message: error.message,
            stack: error.stack,
            userId: ctx.from?.id,
            chatId: ctx.chat?.id,
            messageText: ctx.message?.text,
            timestamp: new Date().toISOString()
        };

        this.recentErrors.unshift(errorContext);
        if (this.recentErrors.length > 100) this.recentErrors.pop();

        logger.error('[ErrorHandler] Command error', errorContext);

        try {
            const text = `❌ <b>Erro ao executar comando</b>

Código: <code>${errorContext.errorId}</code>

Tente novamente ou contate o suporte.`;

            const Msg = require('../telegram/Msg');
            const { Markup } = require('telegraf');
            await Msg.reply(
                ctx,
                text,
                Markup.inlineKeyboard([[{ text: '🏠 Menu', callback_data: 'menu:home' }]])
            );
        } catch (e) {
            logger.error('[ErrorHandler] Failed to notify about command error', {
                error: e.message
            });
        }
    }

    /**
     * Middleware global para o bot
     */
    globalErrorHandler() {
        return async (ctx, next) => {
            try {
                return await next();
            } catch (error) {
                // Determinar tipo de update
                if (ctx.callbackQuery) {
                    await this.handleCallbackError(ctx, error);
                } else if (ctx.message) {
                    await this.handleCommandError(ctx, error, ctx.message.text?.split(' ')[0]);
                } else {
                    logger.error('[ErrorHandler] Unknown update type error', {
                        error: error.message,
                        updateType: ctx.updateType
                    });
                }
            }
        };
    }

    /**
     * Notifica usuário sobre erro
     */
    async _notifyUser(ctx, errorContext) {
        const { errorId } = errorContext;

        // Tentar answerCbQuery primeiro
        try {
            await ctx.answerCbQuery('❌ Erro ao processar');
        } catch (e) {
            // Callback query pode estar expirado
        }

        // Tentar editar mensagem
        const text = `❌ <b>Ops! Algo deu errado</b>

Código: <code>${errorId}</code>

Tente novamente em instantes.
Se persistir, contate suporte.`;

        await Msg.edit(ctx, text, Markup.inlineKeyboard([
            [{ text: '🏠 Menu', callback_data: 'menu:home' }],
            [{ text: '📞 Suporte', url: process.env.CONTATO_ESPECIALISTA || 'https://t.me/hanorkoff' }],
        ])).catch(() => Msg.reply(ctx, text));
    }

    /**
     * Gera ID único para erro
     */
    _generateErrorId() {
        return `ERR${Date.now().toString(36).toUpperCase().slice(-6)}${Math.random().toString(36).substring(2, 4).toUpperCase()}`;
    }

    /**
     * Retorna estatísticas de erro
     */
    getStats() {
        return {
            totalErrors: this.errorCount,
            recentErrors: this.recentErrors.length,
            lastError: this.recentErrors[0] || null
        };
    }

    /**
     * Limpa histórico de erros
     */
    clearHistory() {
        this.recentErrors = [];
    }
}

// Singleton
const errorHandler = new ErrorHandler();

module.exports = {
    ErrorHandler,
    errorHandler
};
