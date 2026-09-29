'use strict';

/**
 * B2 U4 — fonte única de ações roteáveis para NL planner + gateway.
 * Delega IDs estáveis a hanork-ai-actions; enriquece com hints para o LLM.
 */
const { ACTIONS, ROUTABLE_ACTIONS } = require('../../config/hanork-ai-actions');

const ACTION_HINTS = Object.freeze({
    [ACTIONS.DOWNLOAD]: 'TikTok/Instagram URL em params.url',
    [ACTIONS.PLAY_MUSIC]: 'params.query',
    [ACTIONS.SHOW_PRODUCTS]: 'Abrir catálogo',
    [ACTIONS.RECOMMEND_PRODUCT]: 'Recomendar produto',
    [ACTIONS.PRODUCT_SEARCH]: 'params.query',
    [ACTIONS.CART]: 'Ver carrinho',
    [ACTIONS.CHECKOUT]: 'Finalizar compra',
    [ACTIONS.PIX]: 'Pagamento PIX',
    [ACTIONS.COUPON]: 'Cupom de desconto',
    [ACTIONS.AFFILIATE]: 'Área afiliado',
    [ACTIONS.SUBSCRIPTION]: 'Assinatura VIP',
    [ACTIONS.FLASH_SALES]: 'Vendas relâmpago',
    [ACTIONS.GIVEAWAY]: 'Sorteios',
    [ACTIONS.SUPPORT]: 'Suporte / ticket',
    [ACTIONS.WHATSAPP]: 'Painel WhatsApp (admin)',
    [ACTIONS.BROADCAST]: 'Divulgação geral (admin)',
    [ACTIONS.BROADCAST_GROUPS_PREPARE]: 'Preparar divulgação grupos',
    [ACTIONS.BROADCAST_GROUPS_RUN]: 'Divulgar grupos — params.mode catalog|custom',
    [ACTIONS.BROADCAST_CHANNELS_RUN]: 'Divulgar canais',
    [ACTIONS.BROADCAST_FULL_RUN]: 'Divulgação completa',
    [ACTIONS.BROADCAST_IA_PREPARE]: 'Divulgação com IA',
    [ACTIONS.BROADCAST_TEXT_PREPARE]: 'Divulgação texto livre',
    [ACTIONS.BROADCAST_PRODUCT_PICK]: 'Escolher produto p/ divulgação',
    [ACTIONS.ADMIN]: 'Painel admin',
    [ACTIONS.ADMIN_STATS]: 'Estatísticas',
    [ACTIONS.ADMIN_ORDERS]: 'Pedidos',
    [ACTIONS.ADMIN_PRODUCTS]: 'Produtos',
    [ACTIONS.ADMIN_GROUPS]: 'Grupos',
    [ACTIONS.ADMIN_CHANNELS]: 'Canais',
    [ACTIONS.ADMIN_TICKETS]: 'Tickets',
    [ACTIONS.ADMIN_FINANCE]: 'Financeiro',
    [ACTIONS.ADMIN_REPORT]: 'Relatório',
    [ACTIONS.ADMIN_USERS]: 'Usuários',
    [ACTIONS.HELP]: 'Ajuda',
    [ACTIONS.ACCOUNT]: 'Minha conta',
    [ACTIONS.TRACK_ORDER]: 'Rastrear pedido',
    [ACTIONS.FAVORITES]: 'Favoritos',
    [ACTIONS.RUN_SLASH]: 'params.slash + params.args',
    [ACTIONS.RUN_CALLBACK]: 'params.callback (botão nativo)',
    [ACTIONS.PRODUCT_EDIT_PRICE]: 'Admin — params.productQuery/productId + price',
    [ACTIONS.PRODUCT_PAUSE]: 'Admin — pausar produto',
    [ACTIONS.PRODUCT_REACTIVATE]: 'Admin — reativar produto',
    [ACTIONS.PRODUCT_EDIT_FIELD]: 'Admin — editar campo produto',
});

function getRoutableActionIds() {
    return ROUTABLE_ACTIONS;
}

function isRegisteredAction(actionId) {
    const id = String(actionId || '').trim().toLowerCase();
    return ROUTABLE_ACTIONS.includes(id);
}

function getActionHint(actionId) {
    return ACTION_HINTS[actionId] || null;
}

/** Lista compacta para prompt do HanorkLlmPlanner (U4). */
function formatForPlanner() {
    return ROUTABLE_ACTIONS.map((id) => {
        const hint = ACTION_HINTS[id];
        return hint ? `${id} — ${hint}` : id;
    }).join('\n- ');
}

function getRegistryMeta() {
    return {
        version: '1.0.0',
        source: 'hanork-ai-actions',
        count: ROUTABLE_ACTIONS.length,
        ids: [...ROUTABLE_ACTIONS],
    };
}

module.exports = {
    ACTIONS,
    getRoutableActionIds,
    isRegisteredAction,
    getActionHint,
    formatForPlanner,
    getRegistryMeta,
};
