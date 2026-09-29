'use strict';

/**
 * Lista modos/conversas ativos do usuário (para /cancelar e feedback).
 */
async function collectActiveModes(ctx, checks) {
    const uid = ctx.from?.id;
    const chatId = ctx.chat?.id;
    const lines = [];

    if (checks.campanhaEmailMode && uid && (await checks.campanhaEmailMode.has(uid))) {
        lines.push('📧 Cadastro de e-mail');
    }
    if (checks.hanorkAssistMode && chatId && (await checks.hanorkAssistMode.has(chatId))) {
        lines.push('Hanork — atendimento IA (digite sua dúvida ou fale com a equipe)');
    }
    if (checks.supportMode && chatId && (await checks.supportMode.has(chatId))) {
        lines.push('Ticket com equipe humana (descreva o problema para abrir)');
    }
    if (checks.broadcastMode && uid && checks.isAdmin?.(uid) && (await checks.broadcastMode.has(uid))) {
        lines.push('📢 Modo broadcast admin');
    }
    if (checks.productWizard && uid && checks.productWizard.has(uid)) {
        lines.push('🛍️ Assistente de novo produto');
    }
    if (checks.editProductMode && uid && (await checks.editProductMode.has(uid))) {
        lines.push('✏️ Edição de produto');
    }
    if (checks.adminMsgTarget && uid && (await checks.adminMsgTarget.has(uid))) {
        lines.push('📢 Mensagem direta ao usuário');
    }
    if (checks.joinChatAwaiting && uid && checks.joinChatAwaiting.has(uid)) {
        lines.push('🔗 Aguardando link de grupo/canal (/entrar)');
    }
    if (checks.bridgeLogin && uid && checks.bridgeLogin.isAwaiting(uid)) {
        lines.push('🔌 Conectando ponte Telegram (telefone/código)');
    }
    if (checks.giveawayMode && uid && (await checks.giveawayMode.has(uid))) {
        lines.push('🎉 Criação de sorteio');
    }
    if (checks.catalogSearchMode && uid && checks.catalogSearchMode.has(uid)) {
        lines.push('🔍 Busca no catálogo');
    }
    try {
        const { hasVirtuoSearch } = require('../modules/virtuo/state/virtuoSearchMode');
        if (uid && hasVirtuoSearch(uid)) {
            lines.push('🔍 Busca de país (números SMS)');
        }
    } catch {
        /* ignore */
    }
    if (checks.onboardingStep && chatId && checks.onboardingStep.has(chatId)) {
        lines.push('🌟 Tour inicial');
    }

    return lines;
}

function buildCancelReply(cleared, activeBefore) {
    if (cleared) {
        return '✅ Operação cancelada.';
    }
    if (activeBefore.length) {
        return (
            'ℹ️ <b>Nada novo para cancelar.</b>\n\n' +
            'Modos que ainda parecem ativos:\n' +
            activeBefore.map((l) => `• ${l}`).join('\n') +
            '\n\nUse /cancelar de novo ou /suporte para encerrar ticket.'
        );
    }
    return 'Nada para cancelar no momento.';
}

module.exports = {
    collectActiveModes,
    buildCancelReply,
};
