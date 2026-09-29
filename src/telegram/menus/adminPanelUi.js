'use strict';

const ADMIN_PER_PAGE = 6;

function getAdminPanelItems() {
    const items = [
        { text: 'Estatísticas da loja', callback_data: 'a_stats' },
        { text: 'Conversão e vendas', callback_data: 'a_analytics' },
        { text: 'Funil de conversão', callback_data: 'a_analytics_funil' },
        { text: 'Financeiro e caixa', callback_data: 'a_finance' },
        { text: 'Pedidos e pagamentos', callback_data: 'a_orders' },
        { text: 'Carrinhos ativos', callback_data: 'a_carts' },
        { text: 'Produtos do catálogo', callback_data: 'prod_menu_back' },
        { text: 'Ofertas relâmpago', callback_data: 'a_flash' },
        { text: 'Broadcast em massa', callback_data: 'a_bcast' },
        { text: 'Divulgação e mídia', callback_data: 'a_divulgacao_menu' },
        { text: 'E-mail marketing', callback_data: 'a_email' },
        { text: 'Sorteios e prêmios', callback_data: 'a_giveaways' },
        { text: 'Cupons de desconto', callback_data: 'a_cupons' },
        { text: 'Alcance e destinos', callback_data: 'a_destinos' },
        { text: 'Usuários cadastrados', callback_data: 'a_users' },
        { text: 'Grupos vinculados', callback_data: 'a_grupos' },
        { text: 'Canais vinculados', callback_data: 'a_canais' },
        { text: 'Programa de afiliados', callback_data: 'a_afiliados' },
        { text: 'Tickets de suporte', callback_data: 'a_tickets' },
        { text: 'Avaliações de clientes', callback_data: 'a_reviews' },
        { text: 'Alertas de restock', callback_data: 'a_restock' },
        { text: 'Anti-spam e moderação', callback_data: 'a_spam' },
        { text: 'Backup de dados', callback_data: 'a_backup' },
        { text: 'Gráficos e relatórios', callback_data: 'a_chart' },
        { text: 'Downloads de clientes', callback_data: 'downloads:open' },
        { text: 'Dashboard web', callback_data: 'a_dashboard' },
        { text: 'Modo manutenção', callback_data: 'a_maint' },
        { text: 'Limpar caches', callback_data: 'a_clear' },
        { text: 'Lista de comandos', callback_data: 'a_comandos' },
    ];
    try {
        if (require('../../modules/wa-divulgacao/waDivulgacaoConfig').enabled) {
            items.unshift({ text: 'Hanork Div (WhatsApp)', callback_data: 'a_wadv_menu' });
        }
    } catch {
        /* ignore */
    }
    if (require('../../plugins/zero-divu/config').isZeroDivuEnabled()) {
        items.unshift({ text: 'WhatsApp Zero Divu', callback_data: 'a_wa_menu' });
    }
    try {
        if (require('../../modules/virtuo/virtuoAccess').virtuoMenuButtonLabel(null, () => true)) {
            items.unshift({ text: 'Números SMS Virtuo', callback_data: 'virtuo:home' });
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
                { text: 'Atualizar painel', callback_data: `a_menu_p${safePage}` },
            ]);
        }
    }

    if (totalPages > 1) {
        const pageLabel = `Página ${safePage + 1} de ${totalPages}`;
        if (safePage === 0) {
            inline_keyboard.push([
                { text: pageLabel, callback_data: 'noop' },
                { text: 'Próxima página', callback_data: `a_menu_p${safePage + 1}` },
            ]);
        } else if (safePage >= totalPages - 1) {
            inline_keyboard.push([
                { text: 'Página anterior', callback_data: `a_menu_p${safePage - 1}` },
                { text: pageLabel, callback_data: 'noop' },
            ]);
        } else {
            inline_keyboard.push([
                { text: 'Página anterior', callback_data: `a_menu_p${safePage - 1}` },
                { text: 'Próxima página', callback_data: `a_menu_p${safePage + 1}` },
            ]);
        }
    }

    inline_keyboard.push([
        { text: 'Ver como cliente', callback_data: 'home_user' },
        { text: 'Lista de comandos', callback_data: 'a_comandos' },
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
    return `\n<i>Página ${safePage + 1} de ${totalPages} | use Anterior e Próxima abaixo</i>`;
}

module.exports = {
    ADMIN_PER_PAGE,
    getAdminPanelItems,
    buildAdminPanelKeyboard,
    adminPanelPageLine,
};
