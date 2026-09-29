/**
 * antiSpamCallbackMiddleware.js
 *
 * Helper para verificação de anti-spam em callbacks com:
 * - Resposta imediata (evita botão travado no Telegram)
 * - Distributed lock (evita cliques duplicados)
 * - Cooldown progressivo
 * - Isenção para ações de checkout/pagamento (têm rate limit próprio)
 */

const logger = require('../../config/logger');

/**
 * Cria helper checkCallbackWithResponse injetando dependências.
 *
 * @param {object} antiSpam     - Instância AntiSpam
 * @param {object} stateManager - DistributedStateManager
 * @param {number[]} adminIds   - Array de IDs admin (sem cooldown)
 * @returns {Function} async (ctx, action) => boolean
 */
function createCallbackChecker(antiSpam, stateManager, adminIds = []) {
    const CHECKOUT_PREFIXES = ['checkout', 'checkout_confirm', 'pp_', 'pc_', 'ck_', 'pix_', 'card_'];
    const LOCK_TTL_MS = 2000; // 2 segundos — evita travamento longo

    return async function checkCallbackWithResponse(ctx, action) {
        const chatId = ctx.chat?.id || ctx.callbackQuery?.message?.chat?.id;
        const uid = ctx.from?.id;
        if (!chatId) return false;

        // Admins nunca têm cooldown
        if (uid && adminIds.includes(uid)) {
            try { await ctx.answerCbQuery(); } catch { }
            return true;
        }

        // Checkout/pagamento: responde imediatamente, sem bloquear
        const isCheckout = CHECKOUT_PREFIXES.some(a => action?.startsWith(a));
        if (isCheckout) {
            try { await ctx.answerCbQuery('⏳ Processando...'); } catch { }
            return true;
        }

        // Distributed lock — previne clique duplo (debounce 2s)
        const lockKey = `cb:${chatId}:${action}`;
        const hasLock = stateManager.acquireLock(lockKey, LOCK_TTL_MS);
        if (!hasLock) {
            try { await ctx.answerCbQuery('⏳ Aguarde...'); } catch { }
            logger.info(`[ANTI-SPAM] cb duplicado: ${action} uid=${uid}`);
            return false;
        }

        // Libera o lock imediatamente após garantir unicidade — handler não deve bloquear
        stateManager.releaseLock(lockKey);

        // Anti-spam cooldown por ação
        const allowed = antiSpam.checkCallback(chatId, action, uid);
        if (!allowed) {
            const remainingMs = antiSpam.getCallbackCooldownMs?.(chatId, action) || 0;
            const remaining = Math.max(1, Math.ceil(remainingMs / 1000));
            try {
                await ctx.answerCbQuery(
                    `⏳ Calma — aguarde ${remaining}s antes de clicar de novo.\n\nMuitos cliques seguidos podem limitar sua conta.`,
                    { show_alert: remaining >= 2 }
                );
            } catch { /* ignore */ }
            return false;
        }

        // Feedback imediato ao usuário
        try { await ctx.answerCbQuery(); } catch { }

        return true;
    };
}

module.exports = createCallbackChecker;
