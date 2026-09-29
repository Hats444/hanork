'use strict';

/**
 * Entrar em grupos/canais — joinChat (link +), @público, ponte MTProto.
 */
const logger = require('../config/logger');
const {
    extractInviteHash,
    normalizeInviteLink,
    isPrivateInviteLink,
    isAlreadyParticipant,
    isInviteRequestSent,
    parsePrivateCLink,
} = require('./inviteLinkUtils');
const { validateGroupJoin, formatBlockUserMessage } = require('./groupContentFilter');

function isPermanentBridgeJoinError(msg) {
    const r = String(msg || '').toLowerCase();
    return (
        r.includes('username_invalid') ||
        r.includes('username_not_occupied') ||
        r.includes('no user has') ||
        r.includes('inputpeeruser') ||
        r.includes('username_not_a_group') ||
        r.includes('not_a_group')
    );
}

function isRecoverableBridgeChat(gramChat) {
    return gramChat?.id && ['group', 'supergroup'].includes(gramChat.type);
}

function contentJoinBlock(link, fields) {
    const v = validateGroupJoin({ ...fields, channel: 'tg' });
    if (v.allowed) return null;
    logger.warn('[JoinChat] filtro +18 bloqueou entrada', {
        link,
        reason: v.reason,
        title: fields.title || fields.username,
    });
    return {
        ok: false,
        link,
        contentBlocked: true,
        error: formatBlockUserMessage(v),
    };
}

const INVITE_URL_RE =
    /(?:https?:\/\/)?(?:t\.me|telegram\.me)\/(?:\+([A-Za-z0-9_-]+)|joinchat\/([A-Za-z0-9_-]+))/gi;
const TG_JOIN_RE = /tg:\/\/join\?invite=([A-Za-z0-9_-]+)/gi;
const PUBLIC_URL_RE =
    /(?:https?:\/\/)?(?:t\.me|telegram\.me)\/(@?[a-zA-Z][a-zA-Z0-9_]{4,31})\b/gi;

const SKIP_PUBLIC = new Set([
    'joinchat',
    'addstickers',
    'share',
    'proxy',
    'socks',
    'iv',
    'bg',
    'c',
    'setlanguage',
]);

function toInviteUrl(hash) {
    return `https://t.me/+${hash}`;
}

function parseTelegramTarget(raw) {
    const link = String(raw || '').trim();
    if (isPrivateInviteLink(link)) {
        const norm = normalizeInviteLink(link);
        return { kind: 'invite', link: norm, joinLinks: [norm] };
    }

    const cId = parsePrivateCLink(link);
    if (cId) {
        return {
            kind: 'id',
            link,
            chatId: cId,
            getChatIds: [String(cId)],
            joinLinks: [],
        };
    }

    if (/^-100\d{5,}$/.test(link)) {
        return {
            kind: 'id',
            link,
            chatId: Number(link),
            getChatIds: [link],
            joinLinks: [],
        };
    }
    if (/^-\d{5,}$/.test(link)) {
        return {
            kind: 'id',
            link,
            chatId: Number(link),
            getChatIds: [link],
            joinLinks: [],
        };
    }

    let slug = null;
    const slugFromUrl = link.match(/(?:t\.me|telegram\.me)\/(@?[a-zA-Z][a-zA-Z0-9_]{4,31})/i);
    if (slugFromUrl) slug = slugFromUrl[1].replace(/^@/, '');
    else if (link.startsWith('@')) slug = link.slice(1);
    else if (/^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(link)) slug = link;

    if (!slug || SKIP_PUBLIC.has(slug.toLowerCase())) {
        return { kind: 'unknown', link, getChatIds: [link], joinLinks: [link] };
    }

    const username = `@${slug}`;
    const webUrl = `https://t.me/${slug}`;
    return {
        kind: 'public',
        link: webUrl,
        username,
        slug,
        getChatIds: [username, slug],
        joinLinks: [webUrl, username],
    };
}

async function resolveChat(telegram, target) {
    const ids = target.getChatIds || [];
    if (!ids.length) {
        throw new Error('getChat não suporta link + — use joinChat');
    }
    let lastErr;
    for (const id of ids) {
        try {
            return await telegram.getChat(id);
        } catch (e) {
            lastErr = e;
            logger.debug(`[JoinChat] getChat(${id}):`, e?.description || e?.message);
        }
    }
    throw lastErr;
}

/** Bot API joinChat — removido pelo Telegram (HTTP 404). Mantido só se voltar. */
async function apiJoinChat(telegram, inviteLink) {
    const bridge = require('./TelegramUserBridge');
    if (await bridge.isJoinChatApiMissing(telegram)) {
        const err = new Error('METHOD_UNAVAILABLE');
        err.description = 'joinChat não existe na Bot API (404)';
        throw err;
    }
    const normalized = normalizeInviteLink(inviteLink);
    if (typeof telegram.joinChat === 'function') {
        return await telegram.joinChat(normalized);
    }
    return await telegram.callApi('joinChat', { invite_link: normalized });
}

function extractJoinTargets(text) {
    if (!text || typeof text !== 'string') return [];
    const out = new Set();

    let m;
    INVITE_URL_RE.lastIndex = 0;
    while ((m = INVITE_URL_RE.exec(text)) !== null) {
        const hash = m[1] || m[2];
        if (hash) out.add(toInviteUrl(hash));
    }

    TG_JOIN_RE.lastIndex = 0;
    while ((m = TG_JOIN_RE.exec(text)) !== null) {
        if (m[1]) out.add(toInviteUrl(m[1]));
    }

    PUBLIC_URL_RE.lastIndex = 0;
    while ((m = PUBLIC_URL_RE.exec(text)) !== null) {
        let slug = (m[1] || '').replace(/^@/, '');
        if (!slug || SKIP_PUBLIC.has(slug.toLowerCase())) continue;
        if (slug.startsWith('+') || slug.includes('joinchat')) continue;
        out.add(`https://t.me/${slug}`);
    }

    const at = text.trim().match(/^@([a-zA-Z][a-zA-Z0-9_]{4,31})$/);
    if (at && !SKIP_PUBLIC.has(at[1].toLowerCase())) {
        out.add(`https://t.me/${at[1]}`);
    }

    const atInline = /(?:^|\s)@([a-zA-Z][a-zA-Z0-9_]{4,31})\b/g;
    while ((m = atInline.exec(text)) !== null) {
        if (!SKIP_PUBLIC.has(m[1].toLowerCase())) out.add(`https://t.me/${m[1]}`);
    }

    const cLinkRe = /(?:https?:\/\/)?(?:t\.me|telegram\.me)\/c\/\d+(?:\/\d+)?/gi;
    while ((m = cLinkRe.exec(text)) !== null) {
        out.add(m[0].startsWith('http') ? m[0] : `https://${m[0]}`);
    }

    const idRe = /(?:^|\s)(-100\d{5,14}|-\d{5,14})(?:\s|$)/g;
    while ((m = idRe.exec(text)) !== null) {
        if (m[1]) out.add(m[1].trim());
    }

    for (const token of text.split(/\s+/)) {
        const t = token.replace(/[>,;]+$/g, '');
        if (/^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(t) && !SKIP_PUBLIC.has(t.toLowerCase())) {
            out.add(`https://t.me/${t}`);
        }
    }

    return [...out];
}

function mapJoinError(err, context = '') {
    const msg = String(err?.description || err?.message || err || '');
    const low = msg.toLowerCase();

    if (low.includes('joinchat is not a function') || low.includes('joinchat indisponível')) {
        return 'Erro interno: API joinChat indisponível. Reinicie o bot após npm install.';
    }
    if (isAlreadyParticipant(err)) {
        return 'O bot já está neste chat (sincronizando cadastro…).';
    }
    if (low.includes('invite_hash_expired') || (low.includes('expired') && low.includes('invite'))) {
        return (
            '🔗 <b>Link de convite expirado ou revogado.</b>\n\n' +
            'Peça um <b>link novo</b> ao admin do grupo (Telegram → Convidar → Copiar link) ' +
            'e use <code>/entrar LINK</code> de novo.\n\n' +
            '<i>A ponte já está conectada — só precisa de um link válido.</i>'
        );
    }
    if (low.includes('invite_hash_invalid') || low.includes('hash_invalid')) {
        return 'Link de convite inválido. Copie de novo do Telegram (com +).';
    }
    if (isInviteRequestSent(err)) {
        return 'Pedido de entrada enviado — um admin precisa aprovar o bot.';
    }
    if (low.includes('users_too_much')) {
        return 'Grupo cheio; não há vaga para o bot.';
    }
    if (low.includes('channels_too_much')) {
        return 'O bot atingiu o limite de grupos/canais da conta.';
    }
    if (low.includes('forbidden') || low.includes('bot was blocked')) {
        return 'Sem permissão (bot banido do grupo ou restrito).';
    }
    if (low.includes('chat_invalid') || low.includes('peer_id_invalid')) {
        return `Chat inválido: ${msg}`;
    }
    if (context === 'invite') {
        if (low.includes('not found') && !low.includes('404')) {
            return `Não foi possível entrar pelo convite.\n<i>Telegram:</i> ${msg}`;
        }
        return msg || 'Falha ao entrar pelo link +.';
    }
    if (low.includes('username_not_occupied') || (low.includes('chat not found') && context !== 'invite')) {
        return 'Grupo/canal não encontrado pelo @nome.';
    }
    return msg || 'Não foi possível entrar.';
}

class JoinChatService {
    constructor(telegram, groupService = null) {
        this.telegram = telegram;
        this.groupService = groupService;
    }

    _loadBridge() {
        try {
            return require('./TelegramUserBridge');
        } catch {
            return null;
        }
    }

    async _getBotUsername() {
        try {
            const me = await this.telegram.getMe();
            return me.username || process.env.BOT_USERNAME || 'hanork_bot';
        } catch {
            return process.env.BOT_USERNAME || 'hanork_bot';
        }
    }

    async _saveBridgePromoIfCanPost(chat, { leaveOnFail = false } = {}) {
        if (!isRecoverableBridgeChat(chat)) return false;
        try {
            const { getBridgePoolService } = require('./BridgePoolService');
            const pool = getBridgePoolService({ groupService: this.groupService });
            const validation = await pool.validateChatForPool(chat);
            if (!validation.ok) {
                if (leaveOnFail) await pool.rejectAndLeave(chat, validation.reason);
                return false;
            }
            if (!pool.hasCapacity()) {
                if (leaveOnFail) await pool.rejectAndLeave(chat, 'pool_cheio');
                return false;
            }
            return pool.registerValidatedGroup(chat, validation.members).then((r) => {
                if (r.ok) this.groupService?.pinBridgeGroup?.(chat.id, 'entrar');
                return r.ok;
            });
        } catch (e) {
            logger.warn('[JoinChat] saveBridgePromo:', e.message);
            return false;
        }
    }

    async _finalizeBridgeResult(result, link, { saveBridgePromo = true, quiet = false } = {}) {
        if (!result?.chat?.id) {
            return {
                ok: false,
                link,
                error: 'Ponte entrou, mas não obtive o ID do chat.',
            };
        }

        const preBlock = contentJoinBlock(link, {
            title: result.chat.title,
            username: result.chat.username,
        });
        if (preBlock) {
            try {
                const { getBridgePoolService } = require('./BridgePoolService');
                const pool = getBridgePoolService({ groupService: this.groupService });
                await pool.rejectAndLeave(result.chat, preBlock.contentBlocked ? 'filtro_conteudo' : 'blocked');
            } catch {
                /* ignore */
            }
            return preBlock;
        }

        // Bot não foi adicionado nesta tentativa → divulgação via conta MTProto
        if (!result.botAdded) {
            let bridgePromo = false;
            let promoNote =
                '\n\n📡 <i>Grupo salvo — divulgação automática via sua conta MTProto.</i>';

            if (saveBridgePromo) {
                bridgePromo = await this._saveBridgePromoIfCanPost(result.chat, { leaveOnFail: false });
                if (!bridgePromo) {
                    promoNote =
                        '\n\n⚠️ <i>Bot não entrou. Sua conta MTProto <b>permanece no grupo</b>, ' +
                        'mas ele não entrou no pool de divulgação (mín. 50 membros, permissão de envio ou bot admin).</i>';
                }
                logger.info(
                    `[JoinChat] parcial ponte ${result.chat.title || result.chat.id} — promo MTProto (botAdded=0, canPost=${bridgePromo ? 1 : 0})`
                );
            } else if (!quiet) {
                logger.debug(
                    `[JoinChat] ponte ${result.chat.title || result.chat.id} — registro deferido ao pool`
                );
            }

            return {
                ok: 'partial',
                link,
                chat: result.chat,
                viaBridge: true,
                bridgePromo,
                addBotUrl: result.addBotUrl,
                shopUrl: result.shopUrl,
                error: saveBridgePromo ? (result.hint || '') + promoNote : result.hint || '',
            };
        }

        let botIsAdmin = 0;
        try {
            const me = await this.telegram.getMe();
            if (me?.id) {
                const member = await this.telegram.getChatMember(result.chat.id, me.id);
                botIsAdmin = ['administrator', 'creator'].includes(member.status) ? 1 : 0;
            }
        } catch {
            /* ignore */
        }

        this.groupService?.clearBridgePromo?.(result.chat.id);
        return {
            ...this._registerChat(result.chat, botIsAdmin, false),
            link,
            viaBridge: true,
        };
    }

    _chatTypeLabel(chat) {
        const t = chat?.type;
        if (t === 'channel') return 'canal';
        if (t === 'supergroup') return 'supergrupo';
        if (t === 'group') return 'grupo';
        return 'chat';
    }

    async refreshBotRole(chatId) {
        try {
            const me = await this.telegram.getMe();
            const member = await this.telegram.getChatMember(chatId, me.id);
            return ['administrator', 'creator'].includes(member.status) ? 1 : 0;
        } catch {
            return 0;
        }
    }

    _registerChat(chat, botIsAdmin, alreadyMember) {
        const blocked = contentJoinBlock(null, {
            title: chat.title,
            username: chat.username,
        });
        if (blocked) {
            return { ...blocked, chat, link: null };
        }
        if (this.groupService?.upsertGroup) {
            this.groupService.upsertGroup(chat, botIsAdmin);
        }
        logger.info(
            `[JoinChat] OK ${chat.title || chat.id} (${chat.id}) admin=${botIsAdmin}${alreadyMember ? ' (já membro)' : ''}`
        );
        return {
            ok: true,
            chat,
            botIsAdmin: !!botIsAdmin,
            alreadyMember: !!alreadyMember,
        };
    }

    /** Bot já no grupo — obtém chat_id sem getChat(URL +) */
    async _syncBotAlreadyInInviteGroup(inviteLink) {
        const link = normalizeInviteLink(inviteLink);

        try {
            const chat = await apiJoinChat(this.telegram, link);
            const botIsAdmin = await this.refreshBotRole(chat.id);
            return { ...this._registerChat(chat, botIsAdmin, true), link };
        } catch {
            /* continua */
        }

        const bridge = this._loadBridge();
        if (bridge?.isConfigured()) {
            try {
                const gramChat = await bridge.resolveChatFromInvite(link);
                if (gramChat?.id) {
                    const botIsAdmin = await this.refreshBotRole(gramChat.id);
                    return { ...this._registerChat(gramChat, botIsAdmin, true), link };
                }
            } catch (e) {
                logger.warn('[JoinChat] resolveChatFromInvite:', e.message);
            }
        }

        return {
            ok: false,
            link,
            error:
                'O bot parece já estar no grupo, mas não consegui obter o ID.\n' +
                'Configure a ponte MTProto no .env ou use /grupo sync.',
        };
    }

    /** Ponte: usuário entra no + → bot tenta joinChat de novo */
    async _bridgeAssistInviteJoin(inviteLink) {
        const bridge = this._loadBridge();
        if (!bridge?.isConfigured()) return null;

        const link = normalizeInviteLink(inviteLink);
        try {
            logger.info('[JoinChat] ponte: ImportChatInvite (conta usuário)…');
            await bridge.userImportInvite(link);
            const chat = await apiJoinChat(this.telegram, link);
            const botIsAdmin = await this.refreshBotRole(chat.id);
            return {
                ...this._registerChat(chat, botIsAdmin, false),
                link,
                viaBridge: true,
            };
        } catch (e) {
            logger.warn('[JoinChat] ponte+joinChat:', e?.description || e?.message || e.message);
            return null;
        }
    }

    async _syncIfAlreadyMember(link, chat) {
        const me = await this.telegram.getMe();
        try {
            const member = await this.telegram.getChatMember(chat.id, me.id);
            if (['member', 'administrator', 'creator', 'restricted'].includes(member.status)) {
                const botIsAdmin = ['administrator', 'creator'].includes(member.status) ? 1 : 0;
                return {
                    ...this._registerChat(chat, botIsAdmin, true),
                    link,
                };
            }
        } catch {
            /* não é membro */
        }
        return null;
    }

    /** Link https://t.me/+HASH — ponte MTProto (joinChat da Bot API não existe mais) */
    async joinInviteLink(rawLink, opts = {}) {
        const link = normalizeInviteLink(rawLink);
        const bridge = this._loadBridge();

        if (!bridge?.canUseBridge?.()) {
            return {
                ok: false,
                link,
                error: bridge?.setupHelpHtml?.() || 'Ponte MTProto indisponível.',
            };
        }

        if (!bridge.isConfigured()) {
            return {
                ok: false,
                link,
                needsBridge: true,
                error: bridge.setupHelpHtml(),
            };
        }

        try {
            const botUser = await this._getBotUsername();
            const pre = await bridge.precheckInvite(link);
            if (pre?.expired) {
                return {
                    ok: false,
                    link,
                    error: mapJoinError({ errorMessage: 'INVITE_HASH_EXPIRED' }, 'invite'),
                };
            }
            if (pre?.invalid) {
                return {
                    ok: false,
                    link,
                    error: mapJoinError({ errorMessage: 'INVITE_HASH_INVALID' }, 'invite'),
                };
            }
            if (pre?.title) {
                const blocked = contentJoinBlock(link, { title: pre.title });
                if (blocked) return blocked;
            }
            logger.info(`[JoinChat] ponte MTProto (+): ${link}`);
            const result = await bridge.joinGroupAndInviteBot(link, botUser);
            return this._finalizeBridgeResult(result, link, opts);
        } catch (e) {
            const detail = String(e?.errorMessage || e?.message || e || '').trim();
            logger.error(`[JoinChat] ponte FAIL ${link}`, { detail: detail || 'erro desconhecido' });
            return {
                ok: false,
                link,
                error: mapJoinError(e, 'invite'),
            };
        }
    }

    async _tryUserBridgeJoin(slug, displayLink, { tryPublicFirst = true, saveBridgePromo = true, quiet = false, noDiscover = false } = {}) {
        const bridge = this._loadBridge();
        if (!bridge?.canUseBridge?.()) {
            return null;
        }
        if (!bridge.isConfigured()) {
            return {
                ok: false,
                link: displayLink,
                needsBridge: true,
                error: bridge.setupHelpHtml(),
            };
        }

        const botUser = await this._getBotUsername();

        if (tryPublicFirst && slug) {
            try {
                if (!quiet) logger.info(`[JoinChat] ponte @${slug}`);
                const pub = await bridge.joinPublicAndInviteBot(slug, botUser);
                return this._finalizeBridgeResult(pub, displayLink, { saveBridgePromo, quiet });
            } catch (e) {
                const logFn = quiet || isPermanentBridgeJoinError(e.message) ? logger.debug.bind(logger) : logger.warn.bind(logger);
                logFn('[JoinChat] ponte público:', e.message);
                if (!isPermanentBridgeJoinError(e.message) && saveBridgePromo) {
                    try {
                        const { gramChatToBotChat } = require('./inviteLinkUtils');
                        const gramChat = await bridge.withClient(async (client) => {
                            const entity = await client.getEntity(slug);
                            if (entity?.className === 'User') return null;
                            return gramChatToBotChat(entity);
                        });
                        if (isRecoverableBridgeChat(gramChat)) {
                            logger.info(`[JoinChat] ponte @${slug} — salvando promo após erro parcial`);
                            const bridgePromo = await this._saveBridgePromoIfCanPost(gramChat);
                            const pitch = require('../telegram/botInviteCopy').buildGroupInvitePitch(
                                gramChat,
                                botUser
                            );
                            return {
                                ok: 'partial',
                                link: displayLink,
                                chat: gramChat,
                                viaBridge: true,
                                bridgePromo,
                                addBotUrl: pitch.addBotUrl,
                                shopUrl: pitch.shopUrl,
                                error:
                                    `⚠️ Ponte entrou, mas houve erro ao adicionar o bot.\n\n` +
                                    `<i>${e.message}</i>\n\n` +
                                    (bridgePromo
                                        ? `📡 <i>Grupo salvo — divulgação via conta MTProto.</i>`
                                        : `⚠️ <i>Sua conta não pode enviar aqui — divulgação não ativada.</i>`),
                            };
                        }
                    } catch (e2) {
                        logger.debug('[JoinChat] ponte recover:', e2.message);
                    }
                }
            }
        }

        if (noDiscover) {
            return {
                ok: false,
                link: displayLink,
                error: 'Entrada via @username falhou.',
            };
        }

        try {
            const inviteLink = await bridge.discoverInviteLink(slug);
            if (!inviteLink) {
                return {
                    ok: false,
                    link: displayLink,
                    error:
                        `Ponte: nenhum link <code>+</code> em @${slug}.\n` +
                        'Peça o link de convite ou adicione o bot manualmente.',
                };
            }
            return this.joinInviteLink(inviteLink);
        } catch (e) {
            return { ok: false, link: displayLink, error: `Ponte: ${e.message}` };
        }
    }

    /** ID numérico (-100… ou t.me/c/…) */
    async joinByChatId(target, opts = {}) {
        const displayLink = target.link;
        const bridge = this._loadBridge();

        if (bridge?.isConfigured?.()) {
            try {
                const botUser = await this._getBotUsername();
                let bridgeResult = null;
                const { isPrivateCLink } = require('./inviteLinkUtils');
                if (isPrivateCLink(displayLink)) {
                    logger.info(`[JoinChat] ponte t.me/c ${displayLink}`);
                    bridgeResult = await bridge.joinPrivateCLinkAndInviteBot(displayLink, botUser);
                } else if (target.chatId) {
                    logger.info(`[JoinChat] ponte ID ${target.chatId}`);
                    bridgeResult = await bridge.joinChatByIdAndInviteBot(target.chatId, botUser, {
                        displayLink,
                    });
                }
                if (bridgeResult) {
                    return this._finalizeBridgeResult(bridgeResult, displayLink, opts);
                }
            } catch (e) {
                logger.warn('[JoinChat] ponte ID/c:', e.message);
                const { isPrivateCLink } = require('./inviteLinkUtils');
                if (isPrivateCLink(displayLink) && bridge?.isConfigured?.()) {
                    try {
                        const botUser = await this._getBotUsername();
                        const gramChat = await bridge.resolvePrivateCLinkChat(displayLink);
                        if (gramChat?.id) {
                            logger.info(`[JoinChat] ponte t.me/c — salvando promo após erro parcial`);
                            const bridgePromo = await this._saveBridgePromoIfCanPost(gramChat);
                            const pitch = require('../telegram/botInviteCopy').buildGroupInvitePitch(
                                gramChat,
                                botUser
                            );
                            return {
                                ok: 'partial',
                                link: displayLink,
                                chat: gramChat,
                                viaBridge: true,
                                bridgePromo,
                                addBotUrl: pitch.addBotUrl,
                                shopUrl: pitch.shopUrl,
                                error:
                                    `⚠️ Ponte acessou o grupo, mas houve erro ao adicionar o bot.\n\n` +
                                    `<i>${e.message}</i>\n\n` +
                                    (bridgePromo
                                        ? `📡 <i>Grupo salvo — divulgação via conta MTProto.</i>`
                                        : `⚠️ <i>Sua conta não pode enviar aqui — divulgação não ativada.</i>`),
                            };
                        }
                    } catch (e2) {
                        logger.debug('[JoinChat] ponte c recover:', e2.message);
                    }
                }
                if (isPrivateCLink(displayLink)) {
                    return {
                        ok: false,
                        link: displayLink,
                        error:
                            `🔗 <b>Link privado t.me/c</b>\n\n` +
                            `<i>${e.message}</i>\n\n` +
                            `Sua conta MTProto precisa estar no grupo. ` +
                            `Se o bot não entrar, o grupo será salvo para divulgação pelo seu número.`,
                    };
                }
            }
        } else if (bridge?.canUseBridge?.() && !bridge.isConfigured()) {
            const { isPrivateCLink } = require('./inviteLinkUtils');
            if (isPrivateCLink(displayLink)) {
                return {
                    ok: false,
                    link: displayLink,
                    needsBridge: true,
                    error: bridge.setupHelpHtml(),
                };
            }
        }

        let chat;
        try {
            chat = await resolveChat(this.telegram, target);
        } catch (err) {
            const { isPrivateCLink } = require('./inviteLinkUtils');
            if (isPrivateCLink(displayLink) && bridge?.canUseBridge?.()) {
                return {
                    ok: false,
                    link: displayLink,
                    needsBridge: !bridge.isConfigured(),
                    error:
                        `🔗 <b>Grupo privado</b> (t.me/c/…)\n\n` +
                        `O bot não está neste chat.\n\n` +
                        (bridge.isConfigured()
                            ? `<i>${err?.description || err?.message || err}</i>\n\nTente de novo — a ponte MTProto resolve pelo seu número.`
                            : `Conecte a ponte: <code>/conectar</code> (QR) e use o link de novo.`),
                };
            }
            return {
                ok: false,
                link: displayLink,
                error:
                    `Não consegui acessar o ID <code>${target.chatId}</code>.\n` +
                    `<i>${err?.description || err?.message || err}</i>\n\n` +
                    'Use link <code>+</code>, <code>@username</code> ou <code>t.me/c/…</code> com ponte MTProto.',
            };
        }

        const existing = await this._syncIfAlreadyMember(displayLink, chat);
        if (existing) return existing;

        if (chat.username) {
            return this.joinPublicLink(`https://t.me/${chat.username}`);
        }
        if (chat.invite_link && isPrivateInviteLink(chat.invite_link)) {
            return this.joinInviteLink(chat.invite_link);
        }

        const tipo = this._chatTypeLabel(chat);
        return {
            ok: false,
            link: displayLink,
            error:
                `<b>${chat.title || 'Chat'}</b> (${tipo}) sem @username.\n\n` +
                'Use <code>/entrar https://t.me/+...</code> ou peça a um admin adicionar o bot.',
            needsBridge: !!this._loadBridge()?.canUseBridge?.() && !this._loadBridge()?.isConfigured?.(),
        };
    }

    async joinPublicLink(link) {
        const target = parseTelegramTarget(link);
        const displayLink = target.link || link;
        const bridge = this._loadBridge();

        if (target.kind === 'id') {
            return this.joinByChatId(target);
        }

        let chat = null;
        let getChatErr = null;
        try {
            chat = await resolveChat(this.telegram, target);
        } catch (err) {
            getChatErr = err;
        }

        if (chat) {
            const existing = await this._syncIfAlreadyMember(displayLink, chat);
            if (existing) return existing;
        }

        if (target.slug && bridge?.isConfigured()) {
            const slugBlock = contentJoinBlock(displayLink, {
                username: target.slug,
                title: chat?.title || target.slug,
            });
            if (slugBlock) return slugBlock;

            const bridged = await this._tryUserBridgeJoin(target.slug, displayLink, {
                tryPublicFirst: true,
            });
            if (bridged && bridged.ok !== false) return bridged;
            if (bridged?.needsBridge) return bridged;
        }

        if (!chat) {
            if (target.slug && bridge?.canUseBridge?.() && !bridge.isConfigured()) {
                return {
                    ok: false,
                    link: displayLink,
                    needsBridge: true,
                    error:
                        `Não achei <b>@${target.slug}</b> pelo bot.\n` +
                        `${bridge.setupHelpHtml()}`,
                };
            }
            return {
                ok: false,
                link: displayLink,
                error:
                    `Não achei ${target.username || link}.\n` +
                    `<i>${getChatErr?.description || getChatErr?.message || getChatErr}</i>`,
            };
        }

        if (chat.invite_link && isPrivateInviteLink(chat.invite_link)) {
            const viaInvite = await this.joinInviteLink(chat.invite_link);
            if (viaInvite.ok === true || viaInvite.ok === 'partial') return viaInvite;
        }

        const joinLinks = [];
        if (chat.invite_link) joinLinks.push(chat.invite_link);
        for (const u of target.joinLinks || []) {
            if (u && !joinLinks.includes(u)) joinLinks.push(u);
        }

        let lastJoinErr;
        let gotJoinRequest = false;
        for (const inviteUrl of joinLinks) {
            if (!isPrivateInviteLink(inviteUrl)) continue;
            try {
                const joined = await apiJoinChat(this.telegram, inviteUrl);
                const botIsAdmin = await this.refreshBotRole(joined.id);
                return { ...this._registerChat(joined, botIsAdmin, false), link: displayLink };
            } catch (err) {
                lastJoinErr = err;
                if (isInviteRequestSent(err)) gotJoinRequest = true;
                if (isAlreadyParticipant(err)) {
                    return this._syncBotAlreadyInInviteGroup(inviteUrl);
                }
            }
        }

        if (gotJoinRequest || chat.join_by_request) {
            return {
                ok: 'pending',
                link: displayLink,
                error: 'Pedido enviado — precisa de admin para aprovar o bot.',
            };
        }

        if (target.slug) {
            const bridged = await this._tryUserBridgeJoin(target.slug, displayLink, {
                tryPublicFirst: true,
            });
            if (bridged) return bridged;
        }

        const detail = lastJoinErr?.description || lastJoinErr?.message || '';
        const tipo = this._chatTypeLabel(chat);
        const needsBridge =
            bridge?.canUseBridge?.() && !bridge.isConfigured() && ['supergroup', 'channel', 'group'].includes(tipo);

        return {
            ok: false,
            link: displayLink,
            needsBridge,
            error:
                `<b>${chat.title || target.slug}</b> (${tipo}) — bot não entrou.\n` +
                (detail ? `<i>${detail}</i>\n\n` : '') +
                'Tente <code>/entrar https://t.me/+...</code>, <code>@nome</code> ou <code>/ponte</code>.',
        };
    }

    async joinOne(inviteLink) {
        const link = inviteLink.trim();
        const target = parseTelegramTarget(link);
        if (target.kind === 'invite') {
            return this.joinInviteLink(link);
        }
        if (target.kind === 'id') {
            return this.joinByChatId(target);
        }
        return this.joinPublicLink(link);
    }

    /** Entrada pelo pool — só ponte MTProto; registro fica no BridgePoolService. */
    async joinOneForPool(link) {
        const trimmed = String(link || '').trim();
        const target = parseTelegramTarget(trimmed);
        const poolOpts = { saveBridgePromo: false, quiet: true, noDiscover: true };

        if (target.kind === 'invite') {
            return this.joinInviteLink(trimmed, poolOpts);
        }
        if (target.kind === 'id') {
            return this.joinByChatId(target, poolOpts);
        }

        const bridge = this._loadBridge();
        if (!bridge?.isConfigured?.()) {
            return { ok: false, error: 'Ponte MTProto indisponível.' };
        }
        if (!target.slug) {
            return { ok: false, error: 'Link inválido.' };
        }

        const displayLink = target.link || trimmed;
        const bridged = await this._tryUserBridgeJoin(target.slug, displayLink, {
            tryPublicFirst: true,
            ...poolOpts,
        });
        if (bridged?.chat?.id) return bridged;
        return {
            ok: false,
            link: displayLink,
            error: formatErrorReason(bridged?.error, 'Entrada via ponte falhou.'),
        };
    }

    async joinFromText(text) {
        const links = extractJoinTargets(text);
        if (!links.length) return { links: [], results: [], error: 'no_links' };

        const results = [];
        for (const l of links) {
            results.push(await this.joinOne(l));
            await new Promise((r) => setTimeout(r, 400));
        }
        return { links, results };
    }

    static formatResultLine(r) {
        if (r.contentBlocked) {
            return typeof r.error === 'string' ? r.error : '🚫 Grupo bloqueado pelo filtro anti +18.';
        }
        if (r.ok === true && r.chat) {
            const c = r.chat;
            const tipo =
                c.type === 'channel'
                    ? '📡 Canal'
                    : c.type === 'supergroup'
                      ? '👥 Supergrupo'
                      : '👥 Grupo';
            const papel = r.botIsAdmin ? '👑 Admin' : '👤 Membro';
            const ja = r.alreadyMember ? ' (já estava dentro)' : '';
            const ponte = r.viaBridge ? '\n🔌 Via ponte MTProto' : '';
            const user = c.username ? `\n@${c.username}` : '';
            return (
                `✅ <b>${c.title || 'Chat'}</b>${ja}${ponte}\n` +
                `${tipo} · ${papel}\n` +
                `ID: <code>${c.id}</code>${user}`
            );
        }
        if (r.ok === 'pending') {
            return `⏳ <b>Pendente</b>\n${r.link}\n<i>${r.error}</i>`;
        }
        if (r.ok === 'partial' && r.chat) {
            const c = r.chat;
            let txt =
                `⚠️ <b>Parcial</b> — <b>${c.title || 'Grupo'}</b>\n` +
                `ID: <code>${c.id}</code>\n\n` +
                `${r.error || ''}`;
            return { text: txt, addBotUrl: r.addBotUrl || null, shopUrl: r.shopUrl || null };
        }
        if (r.needsBridge) {
            return {
                text:
                    `🔌 <b>Ponte necessária</b>\n<code>${r.link}</code>\n\n${r.error}`,
                needsBridge: true,
            };
        }
        return { text: `❌ <b>Falhou</b>\n<code>${r.link}</code>\n${r.error}` };
    }

    static formatSummary({ links, results }) {
        if (!links?.length) {
            return {
                text:
                    '❌ Nenhum alvo reconhecido.\n\n' +
                    'Exemplos:\n' +
                    '<code>/entrar https://t.me/+AbCdEf...</code>\n' +
                    '<code>/entrar @meugrupo</code>\n' +
                    '<code>/entrar https://t.me/meucanal</code>\n' +
                    '<code>/entrar -1001234567890</code>',
            };
        }
        const parts = results.map((r) => JoinChatService.formatResultLine(r));
        const ok = results.filter((r) => r.ok === true).length;
        const fail = results.filter((r) => r.ok === false).length;
        const pend = results.filter((r) => r.ok === 'pending').length;
        const part = results.filter((r) => r.ok === 'partial').length;
        const needsBridge = results.some((r) => r.needsBridge);
        const addBotUrl = results.find((r) => r.addBotUrl)?.addBotUrl || null;
        const shopUrl = results.find((r) => r.shopUrl)?.shopUrl || null;
        const header =
            `<b>🔗 Entrada em chats</b> (${ok} ok · ${fail} falha${part ? ` · ${part} parcial` : ''}${pend ? ` · ${pend} pendente` : ''})\n\n`;
        const body = parts.map((p) => (typeof p === 'string' ? p : p.text)).join('\n\n');
        return { text: header + body, needsBridge, addBotUrl, shopUrl };
    }

    /** Botões para resposta do /entrar */
    static getReplyKeyboardRows(summary) {
        const rows = [];
        if (summary?.shopUrl) {
            rows.push([{ text: '🛒 Comprar agora', url: summary.shopUrl }]);
        }
        if (summary?.addBotUrl) {
            rows.push([{ text: '➕ Ativar bot no grupo', url: summary.addBotUrl }]);
        }
        if (summary?.needsBridge) {
            rows.push([{ text: '📲 Conectar (QR)', callback_data: 'bridge:ponte' }]);
        }
        rows.push(
            [{ text: '🌐 Grupos', callback_data: 'a_grupos' }],
            [{ text: '🔙 Admin', callback_data: 'a_menu' }]
        );
        const { toTwoCols } = require('../telegram/menus/twoColKeyboard');
        return toTwoCols(rows);
    }
}

module.exports = {
    JoinChatService,
    extractJoinTargets,
    mapJoinError,
    apiJoinChat,
    isPrivateInviteLink,
    parseTelegramTarget,
    resolveChat,
    normalizeInviteLink,
};
