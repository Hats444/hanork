'use strict';

const { escapeTelegramHtml } = require('../htmlEscape');

/** Rótulos unificados — emojis consistentes em todo o bot. */
const MENU_BTN = {
    /** Entrada da loja — usar SEMPRE "Catálogo" (não "Loja") */
    catalogo: (count) =>
        count != null && count > 0 ? `🛍️ Catálogo (${count})` : '🛍️ Catálogo',
    /** @deprecated alias — preferir catalogo */
    loja: (count) =>
        count != null && count > 0 ? `🛍️ Catálogo (${count})` : '🛍️ Catálogo',
    comecar: '🚀 Começar agora',
    verProdutos: '🛒 Ver produtos',
    carrinho: '🛒 Carrinho',
    buscar: '🔍 Buscar',
    ofertas: '🔥 Ofertas',
    downloads: '⬇️ Downloads',
    carteira: (balance) => {
        const n = Number(balance) || 0;
        return n > 0 ? `💳 Carteira R$ ${n.toFixed(2).replace('.', ',')}` : '💳 Carteira Hanork';
    },
    conta: '👤 Minha Conta',
    minhaConta: '👤 Minha Conta',
    ajuda: '❓ Ajuda',
    suporte: '🎫 Suporte',
    menu: '🏠 Menu',
    favoritos: '❤️ Favoritos',
    assistente: '✨ Assistente',
    referencias: '📢 Referências',
    premium: (isSubscriber) => (isSubscriber ? '💎 Hanork Div' : '💎 Planos Premium'),
    smm: '📈 Serviços SMM',
    smmBlocked: '🔒 SMM indisponível',
    virtuo: '📱 Números SMS',
    virtuoBlocked: '🔒 SMS indisponível',
};

/** Navegação catálogo / voltar */
const NAV_BTN = {
    verLista: '📋 Ver lista',
    buscar: '🔍 Buscar',
    formatos: '📂 Formatos',
    listaCompleta: '📋 Lista completa',
    menu: '🏠 Menu',
    voltar: '🔙 Voltar',
    sortMenor: '💲 Menor',
    sortMaior: '💲 Maior',
    sortAz: '🔤 A–Z',
    sortRecentes: '🆕 Recentes',
    sortMenorActive: '• 💲 Menor',
    sortMaiorActive: '• 💲 Maior',
    sortAzActive: '• 🔤 A–Z',
    sortRecentesActive: '• 🆕 Recentes',
};

/** Pagamento — emojis em todos os métodos (sem alterar lógica MP) */
const PAY_BTN = {
    pix: '💠 PIX',
    card: '💳 Cartão ou boleto',
    copyPix: '📋 Copiar PIX',
    verify: '✅ Verificar pagamento',
    cancel: '❌ Cancelar',
    payNow: '💳 Pagar agora',
    backCart: '🔙 Voltar ao carrinho',
    support: '📞 Suporte',
    retry: '🔄 Tentar de novo',
    payWithPix: '💠 Pagar com PIX',
};

/**
 * Complemento opcional no /start — só destaques do catálogo (sem repetir boas-vindas).
 */
function buildStaticMenuAssistantBlock({ productNames = [], productCount = null } = {}) {
    const names = productNames.map((n) => String(n || '').trim()).filter(Boolean).slice(0, 3);
    if (names.length) {
        const listed = names.map((n) => `<b>${escapeTelegramHtml(n)}</b>`).join(', ');
        if (productCount != null && productCount > names.length) {
            return `Destaques: ${listed} e mais ${productCount - names.length} produto(s).`;
        }
        return `Destaques: ${listed}.`;
    }
    if (productCount != null && productCount > 0) {
        return `${productCount} produto(s) digital(is) disponíveis agora.`;
    }
    return '';
}

function isStartIntroAiEnabled() {
    return String(process.env.HANORK_START_INTRO_AI || '').trim() === '1';
}

module.exports = {
    MENU_BTN,
    NAV_BTN,
    PAY_BTN,
    buildStaticMenuAssistantBlock,
    isStartIntroAiEnabled,
};
