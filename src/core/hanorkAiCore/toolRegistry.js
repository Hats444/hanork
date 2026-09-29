'use strict';

/**
 * B4 AI-V4.4 — Tool Registry (planner v2 → ActionRegistry / hanork-ai-actions).
 */
const { ACTIONS } = require('../../config/hanork-ai-actions');
const ActionRegistry = require('../hanorkGateway/ActionRegistry');

/** @type {{ id: string, action: string, requireAdmin?: boolean, hint: string }[]} */
const TOOLS = Object.freeze([
    { id: 'open_catalog', action: ACTIONS.SHOW_PRODUCTS, hint: 'Abrir catálogo/loja' },
    { id: 'open_cart', action: ACTIONS.CART, hint: 'Ver carrinho' },
    { id: 'checkout', action: ACTIONS.CHECKOUT, hint: 'Finalizar compra' },
    { id: 'product_search', action: ACTIONS.PRODUCT_SEARCH, hint: 'params.query' },
    { id: 'recommend_product', action: ACTIONS.RECOMMEND_PRODUCT, hint: 'Recomendar produto' },
    { id: 'track_order', action: ACTIONS.TRACK_ORDER, hint: 'Rastrear pedido' },
    { id: 'support', action: ACTIONS.SUPPORT, hint: 'Abrir suporte' },
    { id: 'play_music', action: ACTIONS.PLAY_MUSIC, hint: 'params.query' },
    { id: 'download', action: ACTIONS.DOWNLOAD, hint: 'params.url TikTok/Instagram' },
    { id: 'open_admin', action: ACTIONS.ADMIN, requireAdmin: true, hint: 'Painel admin' },
    { id: 'broadcast_groups', action: ACTIONS.BROADCAST_GROUPS_RUN, requireAdmin: true, hint: 'Divulgar grupos' },
    { id: 'whatsapp_panel', action: ACTIONS.WHATSAPP, requireAdmin: true, hint: 'Painel WhatsApp' },
]);

const _byId = new Map(TOOLS.map((t) => [t.id, t]));

function getTools({ adminOnly = false } = {}) {
    return TOOLS.filter((t) => !t.requireAdmin || adminOnly);
}

function formatForPlanner({ adminOnly = false } = {}) {
    return getTools({ adminOnly })
        .map((t) => `${t.id} — ${t.hint}${t.requireAdmin ? ' (admin)' : ''}`)
        .join('\n- ');
}

function resolveTool(toolId, params = {}, { isAdmin = false } = {}) {
    const id = String(toolId || '').trim().toLowerCase();
    const tool = _byId.get(id);
    if (!tool) return null;
    if (tool.requireAdmin && !isAdmin) return null;
    if (!ActionRegistry.isRegisteredAction(tool.action)) return null;
    return {
        action: tool.action,
        params: params && typeof params === 'object' ? { ...params } : {},
        toolId: id,
    };
}

function isKnownTool(toolId) {
    return _byId.has(String(toolId || '').trim().toLowerCase());
}

function getRegistryMeta() {
    return {
        version: '1.0.0',
        count: TOOLS.length,
        ids: TOOLS.map((t) => t.id),
    };
}

module.exports = {
    TOOLS,
    getTools,
    formatForPlanner,
    resolveTool,
    isKnownTool,
    getRegistryMeta,
};
