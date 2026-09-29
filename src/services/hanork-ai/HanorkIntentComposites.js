'use strict';

const { ACTIONS } = require('../../config/hanork-ai-actions');

/**
 * Frases NL → ação nativa (hanorkia v1.0 + catálogo /help).
 * Alta confiança; não substitui scoreAction paramétrico (URL, query produto/música).
 */
function getIntentComposites() {
    return [
        // —— Spec hanorkia.md ——
        {
            action: ACTIONS.DOWNLOAD,
            keys: [
                'baixa esse video',
                'baixar esse video',
                'abaixa esse video',
                'salvar video',
                'baixar midia',
                'baixar audio',
                'converter mp3',
                'abaixa um video',
                'baixa um video',
            ],
            score: 88,
        },
        {
            action: ACTIONS.SHOW_PRODUCTS,
            keys: [
                'me mostra um produto',
                'mostra um produto',
                'mostra produtos',
                'ver produtos',
                'abrir catalogo',
                'abrir loja',
                'ver loja',
                'quero comprar algo',
                'me mostra produtos',
            ],
            score: 94,
        },
        {
            action: ACTIONS.RECOMMEND_PRODUCT,
            keys: [
                'me indica algo',
                'qual produto voce recomenda',
                'qual o melhor produto',
                'me indica um produto',
                'indica algo bom',
                'recomenda algo',
            ],
            score: 92,
        },
        {
            action: ACTIONS.CART,
            keys: ['abre meu carrinho', 'ver carrinho', 'minhas compras', 'meus itens', 'itens no carrinho'],
            score: 90,
        },
        {
            action: ACTIONS.CHECKOUT,
            keys: ['finalizar compra', 'fechar compra', 'pagar pedido', 'quero pagar', 'ir pro checkout'],
            score: 90,
        },
        {
            action: ACTIONS.PRODUCT_EDIT_PRICE,
            keys: [
                'muda o preco do produto',
                'muda o valor do produto',
                'coloca o preco do produto',
                'altera o preco',
                'troca o preco',
                'deixa mais barato',
                'coloca ele por',
            ],
            score: 92,
        },
        {
            action: ACTIONS.PRODUCT_PAUSE,
            keys: [
                'pausa o produto',
                'pausar produto',
                'remove produto',
                'apaga produto',
                'exclui produto',
                'desativa produto',
            ],
            score: 90,
        },
        {
            action: ACTIONS.PRODUCT_REACTIVATE,
            keys: [
                'reativa o produto',
                'reativar produto',
                'ativa o produto',
                'ativar produto',
            ],
            score: 90,
        },
        {
            action: ACTIONS.PIX,
            keys: ['como funciona o pix', 'gerar pix', 'codigo pix', 'pagar com pix', 'quero pix'],
            score: 88,
        },
        {
            action: ACTIONS.SUBSCRIPTION,
            keys: [
                'como funciona o premium',
                'plano premium',
                'quero premium',
                'assinatura premium',
                'ver assinatura',
                'ver plano',
            ],
            score: 90,
        },
        {
            action: ACTIONS.COUPON,
            keys: ['aplicar cupom', 'tenho cupom', 'codigo de desconto', 'usar cupom', 'cupom desconto'],
            score: 88,
        },
        {
            action: ACTIONS.AFFILIATE,
            keys: [
                'meu link de afiliado',
                'link de indicacao',
                'painel afiliado',
                'quero ser afiliado',
                'programa afiliado',
                'minha comissao',
            ],
            score: 88,
        },
        {
            action: ACTIONS.FLASH_SALES,
            keys: ['oferta relampago', 'flash sale', 'promocoes ativas', 'ver promocoes', 'ofertas ativas'],
            score: 86,
        },
        {
            action: ACTIONS.GIVEAWAY,
            keys: ['sorteio ativo', 'tem sorteio', 'participar sorteio', 'ver sorteio'],
            score: 86,
        },
        {
            action: ACTIONS.SUPPORT,
            keys: [
                'preciso de ajuda',
                'falar com suporte',
                'abrir ticket',
                'suporte humano',
                'falar com atendente',
                'falar com equipe',
            ],
            score: 88,
        },
        {
            action: ACTIONS.WHATSAPP,
            adminOnly: true,
            keys: ['status whatsapp', 'campanhas whatsapp', 'painel whatsapp', 'zero divu', 'modulo whatsapp'],
            score: 92,
        },
        {
            action: ACTIONS.BROADCAST,
            adminOnly: true,
            keys: ['painel divulgacao', 'painel broadcast', 'campanha divulgacao', 'anuncio campanha'],
            score: 94,
        },

        // —— Admin (spec + painel) ——
        {
            action: ACTIONS.ADMIN,
            adminOnly: true,
            keys: ['abrir painel admin', 'painel admin', 'painel administrativo', 'modo admin'],
            score: 92,
        },
        {
            action: ACTIONS.ADMIN_ORDERS,
            adminOnly: true,
            keys: ['ver pedidos', 'lista pedidos', 'pedidos pendentes', 'gerenciar pedidos'],
            score: 88,
        },
        {
            action: ACTIONS.ADMIN_FINANCE,
            adminOnly: true,
            keys: ['ver financeiro', 'painel financeiro', 'entradas e saidas', 'modulo financeiro'],
            score: 88,
        },
        {
            action: ACTIONS.ADMIN_USERS,
            adminOnly: true,
            keys: ['lista usuarios', 'ver usuarios', 'clientes cadastrados', 'gerenciar usuarios'],
            score: 88,
        },
        {
            action: ACTIONS.ADMIN_REPORT,
            adminOnly: true,
            keys: ['ver relatorio', 'relatorio financeiro', 'gerar relatorio', 'relatorio vendas'],
            score: 92,
        },
        {
            action: ACTIONS.ADMIN_GROUPS,
            adminOnly: true,
            keys: ['lista de grupos', 'gerenciar grupos', 'ver grupos cadastrados'],
            score: 86,
        },
        {
            action: ACTIONS.ADMIN_CHANNELS,
            adminOnly: true,
            keys: ['lista de canais', 'gerenciar canais', 'ver canais cadastrados'],
            score: 86,
        },
        {
            action: ACTIONS.ADMIN_TICKETS,
            adminOnly: true,
            keys: ['tickets abertos', 'ver tickets admin', 'chamados abertos'],
            score: 86,
        },
        {
            action: ACTIONS.ADMIN_PRODUCTS,
            adminOnly: true,
            keys: ['gerenciar produtos', 'admin produtos', 'catalogo admin', 'editar produtos'],
            score: 87,
        },
        {
            action: ACTIONS.RUN_CALLBACK,
            adminOnly: true,
            callback: 'a_dashboard',
            label: 'Dashboard Web',
            keys: [
                'abre dashboard',
                'abrir dashboard',
                'mostra dashboard',
                'abre dashbord',
                'dashboard web',
                'painel web',
                'dashbord',
            ],
            score: 96,
        },
        {
            action: ACTIONS.RUN_CALLBACK,
            adminOnly: true,
            callback: 'a_backup',
            label: 'Backup',
            keys: ['fazer backup', 'backup banco', 'backup manual', 'backup dados'],
            score: 96,
        },
        {
            action: ACTIONS.RUN_CALLBACK,
            adminOnly: true,
            callback: 'a_maint',
            label: 'Manutenção',
            keys: ['modo manutencao', 'ativar manutencao', 'manutencao loja'],
            score: 90,
        },

        // —— Divulgação admin ——
        {
            action: ACTIONS.BROADCAST_GROUPS_RUN,
            adminOnly: true,
            keys: ['divulga grupos', 'grupos produto'],
            score: 96,
        },
        {
            action: ACTIONS.BROADCAST_GROUPS_PREPARE,
            adminOnly: true,
            keys: ['inicia divulgacao grupos', 'prepara divulgacao grupos'],
            score: 92,
        },
        {
            action: ACTIONS.BROADCAST_CHANNELS_RUN,
            adminOnly: true,
            keys: ['divulga canais', 'canais produto'],
            score: 96,
        },
        {
            action: ACTIONS.BROADCAST_FULL_RUN,
            adminOnly: true,
            keys: ['divulgacao completa', 'dispara divulgacao', 'divulga completa'],
            score: 91,
        },
        {
            action: ACTIONS.BROADCAST_IA_PREPARE,
            adminOnly: true,
            keys: ['divulgacao ia', 'divulga ia', 'divulga com ia'],
            score: 90,
        },
        {
            action: ACTIONS.BROADCAST_TEXT_PREPARE,
            adminOnly: true,
            keys: ['divulgacao texto', 'texto livre divulgacao'],
            score: 88,
        },
        {
            action: ACTIONS.BROADCAST_PRODUCT_PICK,
            adminOnly: true,
            keys: ['divulgar produto', 'anunciar produto', 'promover produto'],
            score: 90,
        },

        // —— Música / downloads (atalhos) ——
        {
            action: ACTIONS.PLAY_MUSIC,
            keys: [
                'ouvir musica',
                'procurar musica',
                'tocar musica',
                'manda musica',
                'me manda musica',
                'envia musica',
                'quero ouvir',
            ],
            score: 85,
        },
        {
            action: ACTIONS.DOWNLOAD,
            keys: [
                'baixar video youtube',
                'youtube video',
                'baixa youtube',
                'baixar video',
                'abaixa video',
                'abaixar video',
                'download video',
                'baixar musica mp3',
            ],
            score: 88,
        },

        // —— Comandos /help via RUN_SLASH ——
        {
            action: ACTIONS.RUN_SLASH,
            slash: 'start',
            keys: ['menu principal', 'abrir menu', 'voltar pro menu', 'ir pro menu', 'menu inicio'],
            score: 88,
        },
        {
            action: ACTIONS.RUN_SLASH,
            slash: 'help',
            keys: ['lista comandos', 'ver comandos', 'quais comandos', 'todos comandos', 'comandos disponiveis'],
            score: 90,
        },
        {
            action: ACTIONS.RUN_SLASH,
            slash: 'comandos',
            keys: ['json comandos', 'arquivo comandos'],
            score: 86,
        },
        {
            action: ACTIONS.RUN_SLASH,
            slash: 'cat',
            keys: ['abrir catalogo paginado', 'catalogo paginado'],
            score: 84,
        },
        {
            action: ACTIONS.RUN_SLASH,
            slash: 'catalogo',
            keys: ['catalogo com botoes', 'catalogo botao'],
            score: 84,
        },
        {
            action: ACTIONS.RUN_SLASH,
            slash: 'downloads',
            keys: ['central downloads', 'menu downloads', 'hub downloads', 'painel downloads'],
            score: 90,
        },
        {
            action: ACTIONS.RUN_SLASH,
            slash: 'carrinho',
            keys: ['comando carrinho'],
            score: 82,
        },
        {
            action: ACTIONS.RUN_SLASH,
            slash: 'checkout',
            keys: ['comando checkout'],
            score: 82,
        },
        {
            action: ACTIONS.RUN_SLASH,
            slash: 'cupom',
            keys: ['comando cupom'],
            score: 82,
        },
        {
            action: ACTIONS.RUN_SLASH,
            slash: 'afiliado',
            keys: ['comando afiliado'],
            score: 82,
        },
        {
            action: ACTIONS.RUN_SLASH,
            slash: 'assinatura',
            keys: ['comando assinatura'],
            score: 82,
        },
        {
            action: ACTIONS.RUN_SLASH,
            slash: 'flashsales',
            keys: ['comando flash sales', 'comando flashsales'],
            score: 82,
        },
        {
            action: ACTIONS.RUN_SLASH,
            slash: 'suporte',
            keys: ['comando suporte'],
            score: 82,
        },
        {
            action: ACTIONS.RUN_SLASH,
            slash: 'reenviar',
            keys: ['reenviar produto', 'pedir reenvio', 'nao recebi produto', 'reenviar entrega'],
            score: 86,
        },
        {
            action: ACTIONS.RUN_SLASH,
            slash: 'email',
            keys: ['cadastrar email', 'registrar email', 'cadastrar gmail', 'verificar email'],
            score: 86,
        },
        {
            action: ACTIONS.RUN_SLASH,
            slash: 'gmail',
            keys: ['cadastrar gmail'],
            score: 84,
        },
        {
            action: ACTIONS.RUN_SLASH,
            slash: 'meusdados',
            keys: ['meus dados', 'minha conta', 'dados da conta', 'ver perfil'],
            score: 88,
        },
        {
            action: ACTIONS.RUN_SLASH,
            slash: 'favoritos',
            keys: ['meus favoritos', 'produtos favoritos', 'ver favoritos'],
            score: 88,
        },
        {
            action: ACTIONS.RUN_SLASH,
            slash: 'rastrear',
            keys: ['rastrear pedido', 'status pedido', 'acompanhar pedido', 'onde esta pedido'],
            score: 88,
        },
        {
            action: ACTIONS.RUN_SLASH,
            slash: 'pontos',
            keys: ['meus pontos', 'pontos fidelidade', 'ver pontos', 'programa fidelidade'],
            score: 86,
        },
        {
            action: ACTIONS.RUN_SLASH,
            slash: 'cashback',
            keys: ['meu cashback', 'saldo cashback', 'ver cashback'],
            score: 86,
        },
        {
            action: ACTIONS.RUN_SLASH,
            slash: 'saldo',
            keys: ['saldo afiliado', 'meu saldo afiliado', 'comissao acumulada'],
            score: 86,
        },
        {
            action: ACTIONS.RUN_SLASH,
            slash: 'rendimentos',
            keys: ['meus rendimentos', 'ganhos afiliado', 'sacar comissao', 'solicitar saque'],
            score: 86,
        },
        {
            action: ACTIONS.RUN_SLASH,
            slash: 'compartilhar',
            keys: ['link indicar amigos', 'compartilhar loja', 'indicar amigos', 'link indicacao'],
            score: 86,
        },
        {
            action: ACTIONS.RUN_SLASH,
            slash: 'tour',
            keys: ['tour guiado', 'como usar loja', 'primeiro uso', 'tutorial loja'],
            score: 84,
        },
        {
            action: ACTIONS.RUN_SLASH,
            slash: 'tickets',
            keys: ['meus tickets', 'ver tickets', 'tickets suporte'],
            score: 86,
        },
        {
            action: ACTIONS.RUN_SLASH,
            slash: 'play',
            keys: ['baixar musica play'],
            score: 80,
        },
        {
            action: ACTIONS.RUN_SLASH,
            slash: 'tiktok',
            keys: ['baixar tiktok', 'download tiktok'],
            score: 84,
        },
        {
            action: ACTIONS.RUN_SLASH,
            slash: 'instagram',
            keys: ['baixar instagram', 'download instagram', 'baixar reel'],
            score: 84,
        },
        {
            action: ACTIONS.RUN_SLASH,
            slash: 'youtube',
            keys: ['baixar youtube', 'download youtube'],
            score: 84,
        },

        // —— Loja (composites leves; scoreAction enriquece query) ——
        { action: ACTIONS.SHOW_PRODUCTS, keys: ['catalogo', 'ver produtos', 'loja', 'vendas'], score: 84 },
        { action: ACTIONS.RECOMMEND_PRODUCT, keys: ['indica produto', 'recomenda produto', 'me recomenda'], score: 86 },
        { action: ACTIONS.CART, keys: ['carrinho', 'abre carrinho'], score: 88 },
        { action: ACTIONS.CHECKOUT, keys: ['checkout'], score: 88 },
        { action: ACTIONS.PIX, keys: ['pix'], score: 86 },
        { action: ACTIONS.SUPPORT, keys: ['suporte', 'ticket', 'atendente'], score: 85 },
        { action: ACTIONS.SUBSCRIPTION, keys: ['premium', 'assinatura', 'plano'], score: 84 },
        { action: ACTIONS.COUPON, keys: ['cupom', 'desconto'], score: 84 },
        { action: ACTIONS.AFFILIATE, keys: ['afiliado', 'comissao', 'meu link'], score: 84 },
        { action: ACTIONS.GIVEAWAY, keys: ['sorteio', 'giveaway'], score: 84 },
    ];
}

module.exports = { getIntentComposites };
