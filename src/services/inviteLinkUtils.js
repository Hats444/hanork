'use strict';

/** Hash do convite (parte depois do + ou joinchat/) */
function extractInviteHash(link) {
    const m = String(link || '').match(/(?:t\.me\/\+|t\.me\/joinchat\/|join\?invite=)([A-Za-z0-9_-]+)/i);
    return m ? m[1] : null;
}

/** URL canônica https://t.me/+HASH */
function normalizeInviteLink(link) {
    const hash = extractInviteHash(link);
    if (hash) return `https://t.me/+${hash}`;
    const s = String(link || '').trim();
    if (!s) return s;
    if (!s.startsWith('http')) return `https://${s}`;
    return s;
}

function isPrivateInviteLink(url) {
    return /t\.me\/\+|t\.me\/joinchat\/|tg:\/\/join\?invite=/i.test(url);
}

function isAlreadyParticipant(err) {
    const msg = String(err?.description || err?.message || err || '').toLowerCase();
    return msg.includes('already') && msg.includes('participant');
}

function isInviteRequestSent(err) {
    const msg = String(err?.description || err?.message || err || '').toLowerCase();
    return msg.includes('invite_request_sent');
}

/** ID GramJS channel → Bot API (-100…) */
function channelIdToBotApi(id) {
    const n = Number(id);
    if (!Number.isFinite(n)) return id;
    if (n < 0) return n;
    return Number(`-100${n}`);
}

function gramChatToBotChat(gramChat) {
    if (!gramChat) return null;
    if (gramChat.className === 'User') return null;
    const isBasic = gramChat.className === 'Chat';
    const isMegagroup = !!(gramChat.megagroup || gramChat.gigagroup);
    const isBroadcastChannel =
        gramChat.className === 'Channel' && !isMegagroup && gramChat.broadcast !== false;
    const chatId = isBasic ? -Number(gramChat.id) : channelIdToBotApi(gramChat.id);
    let type = 'supergroup';
    if (isBroadcastChannel) type = 'channel';
    else if (isBasic) type = 'group';
    return {
        id: chatId,
        title: gramChat.title || 'Grupo',
        type,
        username: gramChat.username || null,
    };
}

/** Link interno t.me/c/1234567890/… → ID Bot API (-100…) */
function parsePrivateCLink(link) {
    const full = parsePrivateCLinkFull(link);
    return full?.chatId ?? null;
}

/** t.me/c/CHANNEL_ID/MSG_ID — grupo/canal privado (mensagem). */
function parsePrivateCLinkFull(link) {
    const m = String(link || '').match(/(?:t\.me|telegram\.me)\/c\/(\d+)(?:\/(\d+))?/i);
    if (!m) return null;
    const messageId = m[2] ? parseInt(m[2], 10) : null;
    return {
        chatId: channelIdToBotApi(m[1]),
        internalId: m[1],
        messageId: Number.isFinite(messageId) ? messageId : null,
        link: String(link || '').trim(),
    };
}

function isPrivateCLink(link) {
    return /(?:t\.me|telegram\.me)\/c\/\d+/i.test(String(link || ''));
}

const POOL_SKIP_SLUGS = new Set([
    'joinchat', 'addstickers', 'share', 'proxy', 'socks', 'iv', 'bg', 'c', 'setlanguage',
    'gratis', 'gratuita', 'gratuito', 'consulta', 'consultar', 'dados', 'forma', 'venham',
    'plataforma', 'identificamos', 'ganhos', 'superior', 'partir', 'saque', 'taxas',
    'solicite', 'muita', 'lucro', 'ativada', 'jogos', 'sistema', 'turbinado', 'todos',
    'daily', 'roleta', 'esperando', 'pagamentos', 'retorno', 'reais', 'pagamento',
    'completo', 'decole', 'cadastro', 'perdas', 'jogue', 'responsabilidade', 'tiver',
    'algum', 'desses', 'bancos', 'abaixo', 'encosta', 'acontecendo', 'trampo', 'subindo',
    'conta', 'mesmo', 'fazer', 'resumir', 'quero', 'acesso', 'final', 'manda', 'saldo',
    'subir', 'grupo', 'risco', 'perda', 'pegamos', 'dinheiro', 'direto', 'atualizado',
    'passo', 'precisar', 'investir', 'simples', 'vagas', 'abertas', 'tempo', 'entre',
    'agora', 'enquanto', 'muitos', 'apostam', 'gente', 'crescer', 'cansado', 'apenas',
    'chega', 'esperar', 'saques', 'ansiedade', 'outros', 'clone', 'projetos', 'sucesso',
    'bombam', 'grupos', 'scripts', 'prontos', 'variados', 'configurar', 'precisa',
    'controle', 'lucros', 'liberdade', 'transforme', 'seguidores', 'investidores', 'decide',
    'regras', 'futuro', 'chame', 'descubra', 'rolando', 'transformamos', 'ganhem',
    'plataformas', 'coadjuvante', 'aproveitar', 'proibido', 'licenciada', 'pagando',
    'batendo', 'pectrodev',
]);

/** camelCase real (MjTrampos7), não Title Case de propaganda (Proibido, Pagando). */
function hasRealMixedCase(slug) {
    if (/^[A-Z][a-z]+$/.test(slug)) return false;
    const ups = (slug.match(/[A-Z]/g) || []).length;
    if (ups >= 2) return true;
    return /[a-z]/.test(slug) && /[A-Z]/.test(slug) && !/^[A-Z][a-z]+$/.test(slug);
}

/** Username público plausível de grupo/canal (evita palavras soltas em spam). */
function isLikelyGroupUsername(slug) {
    const s = String(slug || '').replace(/^@/, '').trim();
    if (s.length < 5 || s.length > 32) return false;
    if (POOL_SKIP_SLUGS.has(s.toLowerCase())) return false;
    if (!/^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(s)) return false;

    if (/[0-9]/.test(s)) return true;
    if (/_/.test(s)) return true;
    if (/bot$/i.test(s) || /channel$/i.test(s) || /grupo$/i.test(s)) return true;
    if (hasRealMixedCase(s) && s.length >= 6) return true;
    if (/^[a-z][a-z0-9_]{14,31}$/.test(s)) return true;

    if (/^[A-Z]{5,}$/.test(s)) return false;
    if (/^[a-z]{5,13}$/.test(s)) return false;
    if (/^[A-Z][a-z]+$/.test(s)) return false;

    return false;
}

function _extractInviteAndPrivateLinks(text, out) {
    let m;
    const inviteRe =
        /(?:https?:\/\/)?(?:t\.me|telegram\.me)\/(?:\+([A-Za-z0-9_-]+)|joinchat\/([A-Za-z0-9_-]+))/gi;
    while ((m = inviteRe.exec(text)) !== null) {
        const hash = m[1] || m[2];
        if (hash) out.add(`https://t.me/+${hash}`);
    }

    const tgJoinRe = /tg:\/\/join\?invite=([A-Za-z0-9_-]+)/gi;
    while ((m = tgJoinRe.exec(text)) !== null) {
        if (m[1]) out.add(`https://t.me/+${m[1]}`);
    }

    const cLinkRe = /(?:https?:\/\/)?(?:t\.me|telegram\.me)\/c\/\d+(?:\/\d+)?/gi;
    while ((m = cLinkRe.exec(text)) !== null) {
        out.add(m[0].startsWith('http') ? m[0] : `https://${m[0]}`);
    }
}

/**
 * Links válidos para pool ponte.
 * @param {object} [opts]
 * @param {boolean} [opts.inviteOnly] — monitor em grupos ponte: só +, joinchat e t.me/c/
 */
function extractBridgePoolLinks(text, opts = {}) {
    if (!text || typeof text !== 'string') return [];
    const out = new Set();
    let m;

    _extractInviteAndPrivateLinks(text, out);
    if (opts.inviteOnly) return [...out];

    const publicUrlRe = /(?:https?:\/\/)?(?:t\.me|telegram\.me)\/(@?[a-zA-Z][a-zA-Z0-9_]{4,31})\b/gi;
    while ((m = publicUrlRe.exec(text)) !== null) {
        const slug = (m[1] || '').replace(/^@/, '');
        if (isLikelyGroupUsername(slug)) out.add(`https://t.me/${slug}`);
    }

    const atInline = /(?:^|\s)@([a-zA-Z][a-zA-Z0-9_]{4,31})\b/g;
    while ((m = atInline.exec(text)) !== null) {
        if (isLikelyGroupUsername(m[1])) out.add(`https://t.me/${m[1]}`);
    }

    const idRe = /(?:^|\s)(-100\d{5,14})(?:\s|$)/g;
    while ((m = idRe.exec(text)) !== null) {
        if (m[1]) out.add(m[1].trim());
    }

    return [...out];
}

/** Link aceito pelo pool automático (convite, t.me/c/ ou ID). @público só via admin. */
function isAutoPoolInviteLink(link) {
    const s = String(link || '').trim();
    return isPrivateInviteLink(s) || isPrivateCLink(s) || /^-100\d+$/.test(s);
}
function isPublicPoolUsernameLink(link) {
    const s = String(link || '').trim();
    if (isAutoPoolInviteLink(s)) return false;
    return /^https?:\/\/(t\.me|telegram\.me)\/[a-zA-Z]/i.test(s);
}

module.exports = {
    extractInviteHash,
    normalizeInviteLink,
    isPrivateInviteLink,
    isAlreadyParticipant,
    isInviteRequestSent,
    channelIdToBotApi,
    gramChatToBotChat,
    parsePrivateCLink,
    parsePrivateCLinkFull,
    isPrivateCLink,
    isLikelyGroupUsername,
    extractBridgePoolLinks,
    isPublicPoolUsernameLink,
    isAutoPoolInviteLink,
};
