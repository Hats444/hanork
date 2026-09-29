'use strict';

/**
 * Textos do Hanork AI Router — tom profissional, uma resposta por pedido.
 * Spec: config/hanork-ai-router.SPEC.md (hanorkia v1.0)
 */
module.exports = {
    VERSION_LABEL: 'Hanork AI Router v1.0',

    introPanel:
        '<b>Assistente Hanork</b> — atendimento inteligente.\n\n' +
        '<b>Como usar:</b> escreva em linguagem natural, sem precisar decorar comandos.\n' +
        '• <i>Recomenda um produto para mim</i>\n' +
        '• <i>Abre meu carrinho</i> · <i>Como funciona o PIX?</i>\n' +
        '• <i>Números SMS</i> — <code>/numeros whatsapp brasil</code>\n' +
        '• <i>Procura a música …</i> · <i>Baixa esse vídeo</i> + link\n\n' +
        '<code>/hanork</code> + pedido ou <i>Hanork, …</i> também funciona. Ticket humano: botão abaixo.\n\n' +
        '<i>No privado: tudo. Em grupos: catálogo, dicas e downloads — compra e conta só no PV.</i>',

    introPanelGroup:
        '<b>Assistente Hanork</b> — ativo neste grupo.\n\n' +
        '<b>Peça citando Hanork ou use</b> <code>/hanork</code> + pedido:\n' +
        '• <i>Hanork, abre o catálogo</i> · <i>Indica um produto</i>\n' +
        '• <i>Quero seguidores instagram</i> · <i>Toca …</i> + link\n\n' +
        '<b>No grupo:</b> catálogo, recomendações, busca SMM e downloads (se liberados).\n' +
        '<b>Só no privado:</b> carrinho, pagamento, conta e painel admin.',

    hintInvoke:
        '<b>Hanork</b>\n\n' +
        'No privado, <b>você</b> é falar comigo. Exemplos:\n' +
        '• <i>Indica um produto</i> · <i>Abre o catálogo</i> · <i>Quero ouvir …</i>\n' +
        '• <i>Abaixa um vídeo</i> (envie o link do TikTok/Instagram/YouTube)\n' +
        '• <code>/hanork toca paprika</code>',

    commandNotUnderstood:
        '<b>Não entendi esse pedido</b>\n\n' +
        'Tente em uma frase curta, por exemplo:\n' +
        '• <i>Hanork, abre o catálogo</i> · <i>Quero seguidores instagram</i>\n' +
        '• <i>Indica um produto</i> · <i>Toca paprika</i>\n\n' +
        '<i><code>/hanork</code> ou citar <b>Hanork</b> na frase também funciona.</i>',

    greetingReply:
        '<b>Oi!</b> Me diga o que precisa — por exemplo:\n' +
        '• <i>Abre o catálogo</i> · <i>Indica um produto</i>\n' +
        '• <i>Toca …</i> · <i>Quero seguidores instagram</i>',

    privateOnly:
        '<b>Assistente Hanork</b>\n\n' +
        'Use no <b>privado</b> com o bot ou em <b>grupos</b> citando <i>Hanork</i> / <code>/hanork</code>.\n\n' +
        'Compras, pagamento e conta ficam no privado por segurança.',

    supportGroupOnly:
        '<b>Hanork</b>\n\n' +
        'Comandos do assistente funcionam no <b>privado</b> ou no <b>grupo de suporte</b> da loja.\n' +
        'Abra uma conversa direta com o bot para carrinho, checkout e dados da conta.',

    groupPrivateAction:
        '<b>Privacidade</b>\n\n' +
        'Carrinho, checkout, conta e pagamento só no <b>chat privado</b> com o bot — não em grupos.',

    groupAdminPrivate:
        '<b>Admin</b>\n\n' +
        'Comandos de administração do Hanork só no <b>privado</b>. Use <code>/admin</code> ou fale com o bot no PV.',

    rateLimit: (seconds) =>
        `Aguarde <b>${seconds}s</b> antes de enviar outra solicitação ao assistente.`,

    clarify: {
        download:
            'Para eu baixar, envie o <b>link</b> (TikTok, Instagram ou YouTube) no <b>privado</b>. Entre no canal de referências e use <code>/downloads</code>.',
        play_music: 'Qual música deseja? Informe o nome ou cole o link do YouTube.',
        product_search: 'Qual produto você procura? Digite o nome ou parte dele.',
        virtuo_numbers:
            'Qual <b>app</b> e <b>país</b>? Ex.: <code>whatsapp brasil</code> · <code>telegram portugal</code>',
        product_edit_price:
            'Qual produto e qual preço? Ex.: <i>coloca o preço do produto Likes FF pra 29.90</i> ou envie só o valor se já estiver editando um produto.',
        product_edit_field:
            'Qual o novo valor? Ex.: <i>muda o nome do produto Likes para Pack VIP</i>.',
        product_pause:
            'Qual produto pausar? Ex.: <i>pausa o produto Likes FF</i> ou <i>apaga aquele</i> depois de citar o item.',
        product_reactivate:
            'Qual produto reativar? Ex.: <i>reativa o produto Likes FF</i> ou <i>ativa</i> com o produto já em contexto.',
        broadcast_groups:
            'Envie a mensagem HTML agora ou escreva: <i>Hanork, divulga nos grupos: sua mensagem aqui</i>.',
        help:
            'Posso ajudar com loja, música, downloads e PIX. Ex.: <i>indica um produto</i>, <i>quero ouvir …</i>, <i>abaixa um vídeo</i> + link.',
        default: 'Pode especificar um pouco mais o que precisa?',
    },

    adminOnly: 'Esta ação é exclusiva para administradores da loja.',

    adminBroadcastHint:
        '<b>Divulgação (admin)</b>\n\n' +
        '<b>Produto automático (catálogo):</b>\n' +
        '• <i>divulga em todos os grupos</i>\n' +
        '• <i>divulga nos canais</i>\n' +
        '• <i>divulga completa</i> / <i>divulga produtos</i>\n\n' +
        '<b>Texto seu (explícito):</b>\n' +
        '• <i>divulga nos grupos mensagem: Promo 50% hoje</i>\n\n' +
        '<b>Modo preparar (próxima msg):</b>\n' +
        '• <i>prepara divulgação nos grupos mensagem livre</i>\n' +
        '• <i>divulga com ia</i> — tema na sequência',

    recommendLead: (productName) =>
        `<b>Recomendação</b>\n\nSeparamos <b>${productName}</b> para você. Confira a ficha e use <b>Comprar</b> abaixo.`,

    catalogEmpty:
        'No momento não há produtos disponíveis. Tente <code>/cat</code> em instantes ou fale com a equipe.',

    giveawayIdle:
        'Não há sorteio ativo no momento. Acompanhe o canal e o menu para novidades.',

    legacyIaRedirect:
        'O atendimento inteligente está em <code>/hanork</code>.\n\n' +
        'Exemplo: <code>/hanork Como funciona o PIX?</code>',

    ticketOpen: (ticketId) =>
        `<b>Ticket #${ticketId}</b> em andamento.\n\n` +
        'Continue com a equipe ou encerre o ticket pelos botões abaixo.',

    supportFallback: 'Para falar com a equipe, use <code>/suporte</code>.',

    virtuoNumbersHelp:
        '<b>📱 Números SMS — como procurar</b>\n\n' +
        '1. Toque em <b>📱 Números SMS</b> no menu\n' +
        '2. Use <b>Buscar app ou país</b> dentro do hub\n' +
        '3. Ou digite: <code>/numeros whatsapp brasil</code>\n' +
        '   <code>/numeros telegram portugal</code> · <code>/numeros indonesia</code>\n\n' +
        '<i>Funciona para WhatsApp, Telegram, Instagram e outros apps.</i>',
};
