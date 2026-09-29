'use strict';

/**
 * UX de mensagens no PV:
 * - Comando digitado (/help, /carrinho…) → apaga menu anterior do bot e manda novo embaixo
 * - Botão (callback) → edita a mesma mensagem (navegação fluida)
 */

function isSlashCommandMessage(ctx) {
    if (ctx?.callbackQuery) return false;
    const text = (ctx?.message?.text || ctx?.message?.caption || '').trim();
    return /^\/[a-zA-Z0-9_]+/.test(text);
}

function isPrivateChat(ctx) {
    const t = ctx?.chat?.type || ctx?.callbackQuery?.message?.chat?.type;
    return t === 'private' || !t;
}

/** Marca o ctx para resposta “fresca” (middleware em comandos no PV) */
function markFreshUi(ctx) {
    if (!ctx) return;
    ctx.state = ctx.state || {};
    ctx.state.freshUi = true;
}

/**
 * @param {object} ctx
 * @param {object} [options] — forceNew | replaceInPlace
 */
function shouldForceNewMessage(ctx, options = {}) {
    if (options.forceNew === true) return true;
    if (options.replaceInPlace === true) return false;
    if (ctx?.state?.freshUi && isPrivateChat(ctx)) return true;
    if (isPrivateChat(ctx) && isSlashCommandMessage(ctx)) return true;
    return false;
}

module.exports = {
    isSlashCommandMessage,
    isPrivateChat,
    markFreshUi,
    shouldForceNewMessage,
};
