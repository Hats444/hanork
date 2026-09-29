'use strict';

const ADMIN_PER_PAGE = 6;

function getAdminPanelItems() {
    const items = [
        { text: '📊 Stats', callback_data: 'a_stats' },
        { text: '📈 Conversão', callback_data: 'a_analytics' },
        { text: '📉 Funil', callback_data: 'a_analytics_funil' },
        { text: '💰 Financeiro', callback_data: 'a_finance' },
        { text: '📋 Pedidos', callback_data: 'a_orders' },
        { text: '🛒 Carrinhos', callback_data: 'a_carts' },
        { text: '📦 Produtos', callback_data: 'prod_menu_back' },
        { text: '🔥 Flash Sales', callback_data: 'a_flash' },
        { text: '📢 Broadcast', callback_data: 'a_bcast' },
        { text: '🖼 Divulgação', callback_data: 'a_divulgacao_menu' },
        { text: '📧 Email', callback_data: 'a_email' },
        { text: '🎉 Sorteios', callback_data: 'a_giveaways' },
        { text: '🏷️ Cupons', callback_data: 'a_cupons' },
        { text: '📣 Alcance', callback_data: 'a_destinos' },
        { text: '👤 Usuários', callback_data: 'a_users' },
        { text: '👥 Grupos', callback_data: 'a_grupos' },
        { text: '📡 Canais', callback_data: 'a_canais' },
        { text: '🤝 Afiliados', callback_data: 'a_afiliados' },
        { text: '🎫 Tickets', callback_data: 'a_tickets' },
        { text: '⭐ Avaliações', callback_data: 'a_reviews' },
        { text: '🔔 Restock', callback_data: 'a_restock' },
        { text: '🛡️ Anti-Spam', callback_data: 'a_spam' },
        { text: '💾 Backup', callback_data: 'a_backup' },
        { text: '📈 Gráfico', callback_data: 'a_chart' },
        { text: '⬇️ Downloads', callback_data: 'downloads:open' },
        { text: '🌐 Dashboard Web', callback_data: 'a_dashboard' },
        { text: '🔧 Manutenção', callback_data: 'a_maint' },
        { text: '🧹 Limpar Caches', callback_data: 'a_clear' },
        { text: '📖 Comandos', callback_data: 'a_comandos' },
    ];
    try {
        if (require('../../modules/wa-divulgacao/waDivulgacaoConfig').enabled) {
            items.unshift({ text: '📲 Hanork Div', callback_data: 'a_wadv_menu' });
        }
    } catch {
        /* ignore */
    }
    if (require('../../plugins/zero-divu/config').isZeroDivuEnabled()) {
        items.unshift({ text: '📱 WhatsApp', callback_data: 'a_wa_menu' });
    }
    try {
        if (require('../../modules/virtuo/virtuoAccess').virtuoMenuButtonLabel(null, () => true)) {
            items.unshift({ text: '📱 Números SMS', callback_data: 'virtuo:home' });
        }
    } catch {
        /* ignore */
    }
    return items;
}

function buildAdminPanelKeyboard(page = 0) {
    const items = getAdminPanelItems();
    const totalPages = Math.max(1, Math.ceil(items.length / ADMIN_PER_PAGE));
    const safePage = Math.max(0, Math.min(page, totalPages - 1));
    const start = safePage * ADMIN_PER_PAGE;
    const slice = items.slice(start, start + ADMIN_PER_PAGE);

    const inline_keyboard = [];
    for (let i = 0; i < slice.length; i += 2) {
        const left = slice[i];
        const right = slice[i + 1];
        if (right) {
            inline_keyboard.push([left, right]);
        } else {
            inline_keyboard.push([
                left,
                { text: '🔄 Atualizar', callback_data: `a_menu_p${safePage}` },
            ]);
        }
    }

    if (totalPages > 1) {
        const pageLabel = `${safePage + 1} / ${totalPages}`;
        if (safePage === 0) {
            inline_keyboard.push([
                { text: `📄 ${pageLabel}`, callback_data: 'noop' },
                { text: '▶️ Avançar', callback_data: `a_menu_p${safePage + 1}` },
            ]);
        } else if (safePage >= totalPages - 1) {
            inline_keyboard.push([
                { text: '◀️ Voltar', callback_data: `a_menu_p${safePage - 1}` },
                { text: `📄 ${pageLabel}`, callback_data: 'noop' },
            ]);
        } else {
            inline_keyboard.push([
                { text: '◀️ Voltar', callback_data: `a_menu_p${safePage - 1}` },
                { text: '▶️ Avançar', callback_data: `a_menu_p${safePage + 1}` },
            ]);
        }
    }

    inline_keyboard.push([
        { text: '👁️ Ver como cliente', callback_data: 'home_user' },
        { text: '📖 Comandos', callback_data: 'a_comandos' },
    ]);

    return {
        markup: {
            __hanorkPrebuilt: true,
            reply_markup: { inline_keyboard },
        },
        safePage,
        totalPages,
    };
}

function adminPanelPageLine(safePage, totalPages) {
    if (totalPages <= 1) return '';
    return `\n<i>· ${safePage + 1} / ${totalPages} · ◀️ ▶️</i>`;
}

module.exports = {
    ADMIN_PER_PAGE,
    getAdminPanelItems,
    buildAdminPanelKeyboard,
    adminPanelPageLine,
};
