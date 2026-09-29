'use strict';

/**
 * Contrato de ações — Hanork AI Router v1.0 (hanorkia).
 * Valores estáveis para logs e executor; não alterar sem revisar o router.
 */
const ROUTER_VERSION = '1.0.0';

const ACTIONS = Object.freeze({
    NONE: 'none',
    ASK: 'ask',
    DOWNLOAD: 'download',
    PLAY_MUSIC: 'play_music',
    SHOW_PRODUCTS: 'show_products',
    RECOMMEND_PRODUCT: 'recommend_product',
    PRODUCT_SEARCH: 'product_search',
    CART: 'cart',
    CHECKOUT: 'checkout',
    PIX: 'pix',
    COUPON: 'coupon',
    AFFILIATE: 'affiliate',
    SUBSCRIPTION: 'subscription',
    FLASH_SALES: 'flash_sales',
    GIVEAWAY: 'giveaway',
    SUPPORT: 'support',
    WHATSAPP: 'whatsapp',
    BROADCAST: 'broadcast',
    BROADCAST_GROUPS_PREPARE: 'broadcast_groups_prepare',
    BROADCAST_GROUPS_RUN: 'broadcast_groups_run',
    BROADCAST_CHANNELS_RUN: 'broadcast_channels_run',
    BROADCAST_FULL_RUN: 'broadcast_full_run',
    BROADCAST_IA_PREPARE: 'broadcast_ia_prepare',
    BROADCAST_TEXT_PREPARE: 'broadcast_text_prepare',
    BROADCAST_PRODUCT_PICK: 'broadcast_product_pick',
    ADMIN: 'admin',
    ADMIN_STATS: 'admin_stats',
    ADMIN_ORDERS: 'admin_orders',
    ADMIN_PRODUCTS: 'admin_products',
    ADMIN_GROUPS: 'admin_groups',
    ADMIN_CHANNELS: 'admin_channels',
    ADMIN_TICKETS: 'admin_tickets',
    ADMIN_FINANCE: 'admin_finance',
    ADMIN_REPORT: 'admin_report',
    ADMIN_USERS: 'admin_users',
    HELP: 'help',
    ACCOUNT: 'account',
    TRACK_ORDER: 'track_order',
    FAVORITES: 'favorites',
    /** Dispara comando / existente via Telegraf (catálogo completo) */
    RUN_SLASH: 'run_slash',
    /** Abre callback do painel (botão nativo) */
    RUN_CALLBACK: 'run_callback',
    /** Admin: alterar preço de produto via linguagem natural */
    PRODUCT_EDIT_PRICE: 'product_edit_price',
    /** Admin: pausar produto no catálogo (removeproduto) */
    PRODUCT_PAUSE: 'product_pause',
    /** Admin: reativar produto no catálogo (reativarproduto) */
    PRODUCT_REACTIVATE: 'product_reactivate',
    /** Admin: editar campo do produto (nome, desc, estoque…) */
    PRODUCT_EDIT_FIELD: 'product_edit_field',
});

/** Execução automática (spec router.md) */
const CONFIDENCE_AUTO = 90;

/** Pedir confirmação antes de executar */
const CONFIDENCE_CONFIRM = 70;

/** Confiança mínima para executar sem mencionar "Hanork" */
const CONFIDENCE_EXECUTE = 80;

/** Com "Hanork" na frase, limiar reduzido (ainda exige intenção, não é chat livre) */
const CONFIDENCE_EXECUTE_WITH_HANORK = 65;

/** PV com o bot: "você", "me manda" etc. — trata como falar com o Hanork */
const CONFIDENCE_EXECUTE_PRIVATE = 70;

/** Ações que cancelam modo "aguardando ticket" e executam o fluxo nativo */
const OPERATIONAL_OVERRIDE_ACTIONS = Object.freeze(
    Object.values(ACTIONS).filter((a) => a !== ACTIONS.NONE && a !== ACTIONS.SUPPORT && a !== ACTIONS.ASK)
);

/** Ações com lógica paramétrica (URL, query, corpo de mensagem…) */
const PARAMETRIC_ACTIONS = Object.freeze(
    Object.values(ACTIONS).filter(
        (a) =>
            a !== ACTIONS.NONE &&
            a !== ACTIONS.ASK &&
            a !== ACTIONS.RUN_SLASH &&
            a !== ACTIONS.RUN_CALLBACK
    )
);

/** Todas as ações roteáveis (inclui dispatch de comando/callback) */
const ROUTABLE_ACTIONS = Object.freeze(
    Object.values(ACTIONS).filter((a) => a !== ACTIONS.NONE && a !== ACTIONS.ASK)
);

module.exports = {
    ROUTER_VERSION,
    ACTIONS,
    CONFIDENCE_AUTO,
    CONFIDENCE_CONFIRM,
    CONFIDENCE_EXECUTE,
    CONFIDENCE_EXECUTE_WITH_HANORK,
    CONFIDENCE_EXECUTE_PRIVATE,
    OPERATIONAL_OVERRIDE_ACTIONS,
    PARAMETRIC_ACTIONS,
    ROUTABLE_ACTIONS,
};
