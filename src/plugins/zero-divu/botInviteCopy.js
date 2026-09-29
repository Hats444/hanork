'use strict';

/**
 * Textos de convite/divulgação ao adicionar o bot em grupos (ponte MTProto).
 * Configurável via .env — padrão Hanork loja online.
 */
function getBrand() {
    const botTag = String(process.env.BOT_USERNAME || 'hanork_bot').replace(/^@/, '');
    const name =
        process.env.BOT_DISPLAY_NAME?.trim() ||
        process.env.MP_STATEMENT_DESCRIPTOR?.trim() ||
        'Hanork';
    const tagline =
        process.env.BOT_SHOP_TAGLINE?.trim() || '#Loja online 💰';
    const site = (process.env.SITE_HANORK || '').trim();
    const support = (process.env.CONTATO_ESPECIALISTA || 'https://t.me/hanorkoff').trim();
    return { botTag, name, tagline, site, support };
}

function sanitizeStartPayload(p) {
    return String(p || '')
        .replace(/[^A-Za-z0-9_-]/g, '')
        .slice(0, 64);
}

/** Payload do /start que abre a área de compra (catálogo ou checkout direto) */
function resolveShopStartPayload(gramChat = null) {
    const custom = process.env.BOT_SHOP_START_PAYLOAD?.trim();
    if (custom) return sanitizeStartPayload(custom);

    const featured = parseInt(process.env.BOT_FEATURED_PRODUCT_ID || '', 10);
    if (featured > 0) return `buy_${featured}`;

    return 'comprar';
}

function isShopAreaStartPayload(payload) {
    if (!payload) return false;
    const p = sanitizeStartPayload(payload);
    if (['comprar', 'cat', 'catalogo', 'loja', 'shop'].includes(p)) return true;
    if (/^grp_?\d+$/.test(p)) return true;
    return false;
}

function buildShopUrl(botTag, opts = {}) {
    const tag = String(botTag || 'hanork_bot').replace(/^@/, '');
    const startPayload = sanitizeStartPayload(
        opts.startPayload ?? resolveShopStartPayload(opts.gramChat)
    );
    return `https://t.me/${tag}?start=${encodeURIComponent(startPayload)}`;
}

function buildAddBotUrl(botTag, gramChat) {
    const tag = String(botTag || 'hanork_bot').replace(/^@/, '');
    if (gramChat?.id) {
        return `https://t.me/${tag}?startgroup=${gramChat.id}`;
    }
    return `https://t.me/${tag}?startgroup=true`;
}

/** Mensagem postada no grupo — atrai compradores + pede admin adicionar o bot */
function buildGroupInvitePitch(gramChat, botTag) {
    const { name, tagline, site, support } = getBrand();
    const tag = String(botTag || getBrand().botTag).replace(/^@/, '');
    const chatTitle = gramChat?.title || 'grupo';
    const shopPayload = resolveShopStartPayload(gramChat);
    const shopUrl = buildShopUrl(tag, { startPayload: shopPayload, gramChat });
    const addBotUrl = buildAddBotUrl(tag, gramChat);
    const buyCta =
        shopPayload.startsWith('buy_')
            ? '🛒 Comprar agora — checkout direto + PIX'
            : '🛒 Comprar agora — catálogo + PIX automático';

    let text =
        `🛍 <b>${name}</b> · ${tagline}\n\n` +
        `Compre direto no Telegram — sem sair do app:\n\n` +
        `⚡ <b>PIX automático</b> — pagou, recebeu\n` +
        `📦 <b>Entrega instantânea</b> após confirmação\n` +
        `🎁 Cashback, cupons e promoções no privado\n` +
        `🔒 Pagamento seguro (Mercado Pago)\n\n` +
        `👇 <b>Toque para comprar:</b>\n` +
        `<a href="${shopUrl}">${buyCta}</a>\n\n`;

    if (site) {
        text += `🌐 <a href="${site}">${site.replace(/^https?:\/\//, '')}</a>\n\n`;
    }

    text +=
        `━━━━━━━━━━━━━━━━\n` +
        `👑 <i>Admins de «${chatTitle}»:</i> adicionem <code>@${tag}</code> para ` +
        `divulgação automática de produtos aqui (sem spam manual).\n\n` +
        `➕ <a href="${addBotUrl}">Ativar bot neste grupo</a>`;

    return { text, shopUrl, addBotUrl, supportUrl: support, shopPayload };
}

/** Mensagem no PV do admin após /entrar parcial */
function buildAdminInviteHint(gramChat, botTag, { postedInGroup = false, bridgePromo = false } = {}) {
    const { name, tagline } = getBrand();
    const tag = String(botTag || getBrand().botTag).replace(/^@/, '');
    const title = gramChat?.title || 'grupo';
    const { shopUrl, addBotUrl } = buildGroupInvitePitch(gramChat, tag);

    let msg =
        `✅ Ponte entrou em <b>${title}</b>\n\n` +
        `⚠️ Você não é admin — o bot não entrou automaticamente.\n\n` +
        `<b>${name}</b> · ${tagline}\n\n`;

    if (bridgePromo) {
        msg +=
            `📡 <b>Grupo salvo</b> — a divulgação automática (produtos + PIX) ` +
            `será feita pela <b>sua conta MTProto</b> neste grupo, igual nos grupos do bot ` +
            `(envia, edita a mesma mensagem).\n\n`;
    } else if (postedInGroup) {
        msg += `✅ Mensagem de divulgação postada no chat.\n\n`;
    }

    msg +=
        `👉 <b>Adicionar bot</b> (se puder):\n` +
        `<a href="${addBotUrl}">➕ Ativar @${tag} aqui</a>\n\n` +
        `🛒 <b>Link de compra direta:</b>\n` +
        `<code>${shopUrl}</code>\n\n` +
        `<i>Ou peça a um admin adicionar @${tag}</i>`;

    return { text: msg, shopUrl, addBotUrl };
}

module.exports = {
    getBrand,
    sanitizeStartPayload,
    resolveShopStartPayload,
    isShopAreaStartPayload,
    buildShopUrl,
    buildAddBotUrl,
    buildGroupInvitePitch,
    buildAdminInviteHint,
};
