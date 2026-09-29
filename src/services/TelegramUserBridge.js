'use strict';

/**
 * Ponte MTProto opcional — Bot API não tem joinChat (404).
 * Só ativa se TELEGRAM_USER_* ou credenciais salvas via /ponte existirem.
 */
const logger = require('../config/logger');
const {
    extractInviteHash,
    normalizeInviteLink,
    gramChatToBotChat,
} = require('./inviteLinkUtils');

const KV = {
    SESSION: 'bridge:session',
    API_ID: 'bridge:api_id',
    API_HASH: 'bridge:api_hash',
};

let _client = null;
let _clientOp = Promise.resolve();
let _lastSource = null;
let _joinChatApiMissing = null;
let _dbRaw = null;
let _gramJs = null;
let _silentLogger = null;

function setDbRaw(dbRaw) {
    _dbRaw = dbRaw;
}

function _db() {
    if (!_dbRaw) {
        try {
            _dbRaw = require('../config/database-sqlite').connect;
        } catch {
            return null;
        }
    }
    return typeof _dbRaw === 'function' ? _dbRaw() : null;
}

function _kvGet(key) {
    const db = _db();
    if (!db) return null;
    return db.prepare('SELECT value FROM kv_store WHERE key=?').get(key)?.value ?? null;
}

function _kvSet(key, value) {
    const db = _db();
    if (!db) return;
    db.prepare(
        `INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, datetime('now'))`
    ).run(key, String(value));
}

function _kvDel(key) {
    const db = _db();
    if (!db) return;
    db.prepare('DELETE FROM kv_store WHERE key=?').run(key);
}

function isGramJsInstalled() {
    if (_gramJs !== null) return _gramJs.ok;
    try {
        require.resolve('telegram');
        _gramJs = { ok: true };
        return true;
    } catch {
        _gramJs = { ok: false };
        return false;
    }
}

function getSilentLogger() {
    if (_silentLogger) return _silentLogger;
    try {
        const { Logger } = require('telegram/extensions/Logger');
        const { LogLevel } = require('telegram/extensions/Logger');
        _silentLogger = new Logger(LogLevel.NONE);
    } catch {
        _silentLogger = null;
    }
    return _silentLogger;
}

function getCredentials() {
    const envId = parseInt(process.env.TELEGRAM_USER_API_ID || '', 10);
    const envHash = (process.env.TELEGRAM_USER_API_HASH || '').trim();
    if (envId && envHash) {
        return { apiId: envId, apiHash: envHash, source: 'env' };
    }
    const kvId = parseInt(_kvGet(KV.API_ID) || '', 10);
    const kvHash = (_kvGet(KV.API_HASH) || '').trim();
    if (kvId && kvHash) {
        return { apiId: kvId, apiHash: kvHash, source: 'kv' };
    }
    return null;
}

function hasCredentials() {
    return !!getCredentials();
}

function saveCredentials(apiId, apiHash) {
    const id = parseInt(String(apiId || ''), 10);
    const hash = String(apiHash || '').trim();
    if (!id || !hash) throw new Error('API ID ou Hash inválido');
    _kvSet(KV.API_ID, id);
    _kvSet(KV.API_HASH, hash);
    process.env.TELEGRAM_USER_API_ID = String(id);
    process.env.TELEGRAM_USER_API_HASH = hash;
    return { apiId: id, apiHash: hash };
}

function getSessionString() {
    const env = process.env.TELEGRAM_USER_SESSION?.trim();
    if (env) return env;
    return _kvGet(KV.SESSION)?.trim() || '';
}

function saveSession(sessionStr) {
    if (sessionStr) {
        _kvSet(KV.SESSION, sessionStr);
        process.env.TELEGRAM_USER_SESSION = sessionStr;
    }
}

function clearSession() {
    _kvDel(KV.SESSION);
    delete process.env.TELEGRAM_USER_SESSION;
}

/** Ponte disponível para login/uso (pacote instalado). */
function canUseBridge() {
    return isGramJsInstalled();
}

function isConfigured() {
    return hasCredentials() && !!getSessionString();
}

function isReady() {
    return isConfigured();
}

async function destroyClient(client) {
    if (!client) return;
    try {
        await Promise.race([
            client.destroy(),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('destroy timeout')), 5000)
            ),
        ]);
    } catch (e) {
        logger.debug('[UserBridge] destroy:', e.message);
        try {
            await client.disconnect();
        } catch {
            /* ignore */
        }
    }
}

async function resetClient() {
    if (_client) {
        await destroyClient(_client);
    }
    _client = null;
    _linkWatcherInstalled = false;
}

function getClientOptions({ forLogin = false } = {}) {
    return {
        connectionRetries: forLogin ? 2 : 3,
        autoReconnect: !forLogin,
        baseLogger: getSilentLogger(),
        deviceModel: 'Desktop',
        systemVersion: 'Windows 11',
        appVersion: '5.8.3 x64',
        langCode: 'pt',
        systemLangCode: 'pt-BR',
    };
}

function loadGramJs() {
    if (!isGramJsInstalled()) {
        throw new Error('Pacote "telegram" não instalado (ponte opcional).');
    }
    try {
        const { TelegramClient } = require('telegram');
        const { StringSession } = require('telegram/sessions');
        const { Api } = require('telegram');
        return { TelegramClient, StringSession, Api };
    } catch (e) {
        throw new Error('Pacote "telegram" indisponível.');
    }
}

async function getClient() {
    if (_client?.connected) return _client;

    const sessionStr = getSessionString();
    if (!sessionStr) {
        throw new Error('Ponte não conectada. Use /ponte no bot.');
    }
    const creds = getCredentials();
    if (!creds) {
        throw new Error('Credenciais MTProto ausentes. Use /ponte no bot.');
    }

    const { TelegramClient, StringSession } = loadGramJs();
    const client = new TelegramClient(
        new StringSession(sessionStr),
        creds.apiId,
        creds.apiHash,
        getClientOptions({ forLogin: false })
    );

    try {
        await client.connect();
        if (!(await client.checkAuthorization())) {
            await destroyClient(client);
            clearSession();
            await resetClient();
            throw new Error('Sessão expirada. Use /ponte para conectar de novo.');
        }
        _client = client;
        return client;
    } catch (e) {
        await destroyClient(client);
        const msg = String(e.errorMessage || e.message || '').toUpperCase();
        if (msg.includes('AUTH_KEY_UNREGISTERED') || msg.includes('SESSION_REVOKED')) {
            clearSession();
            await resetClient();
        }
        throw e;
    }
}

function _runClientOp(fn) {
    const run = _clientOp.then(() => fn());
    _clientOp = run.catch(() => {});
    return run;
}

async function withClient(fn) {
    return _runClientOp(async () => {
        const client = await getClient();
        try {
            return await fn(client);
        } catch (e) {
            const msg = String(e.errorMessage || e.message || '').toUpperCase();
            if (msg.includes('AUTH_KEY_UNREGISTERED') || msg.includes('SESSION_REVOKED')) {
                clearSession();
                await resetClient();
            }
            throw e;
        }
    });
}

async function isJoinChatApiMissing(telegram) {
    if (_joinChatApiMissing !== null) return _joinChatApiMissing;
    try {
        const axios = require('axios');
        const token = process.env.TOKEN_TELEGRAM;
        if (!token) return true;
        await axios.post(`https://api.telegram.org/bot${token}/joinChat`, {
            invite_link: 'https://t.me/+invalid_test_hash_xx',
        });
        _joinChatApiMissing = false;
    } catch (e) {
        const code = e?.response?.data?.error_code;
        const desc = String(e?.response?.data?.description || '').toLowerCase();
        _joinChatApiMissing = code === 404 && desc === 'not found';
    }
    if (_joinChatApiMissing) {
        logger.debug('[UserBridge] Bot API joinChat indisponível (404)');
    }
    return _joinChatApiMissing;
}

function extractPlusFromText(text) {
    if (!text) return null;
    const m = String(text).match(/(?:https?:\/\/)?t\.me\/\+([A-Za-z0-9_-]+)/i);
    return m ? `https://t.me/+${m[1]}` : null;
}

function chatFromUpdates(updates) {
    if (!updates?.chats?.length) return null;
    for (const c of updates.chats) {
        const mapped = gramChatToBotChat(c);
        if (mapped?.id) return mapped;
    }
    return null;
}

async function resolveChatFromInvite(inviteLink) {
    const hash = extractInviteHash(inviteLink);
    if (!hash) throw new Error('Link + inválido');

    const { Api } = loadGramJs();
    return withClient(async (client) => {
        const checked = await client.invoke(new Api.messages.CheckChatInvite({ hash }));
        if (checked.className === 'ChatInviteAlready' && checked.chat) {
            _lastSource = 'check_invite_already';
            return gramChatToBotChat(checked.chat);
        }
        if (checked.chat) {
            _lastSource = 'check_invite';
            return gramChatToBotChat(checked.chat);
        }
        return null;
    });
}

function _gramErr(e) {
    return String(e?.errorMessage || e?.message || e || '');
}

function _throwInviteError(code) {
    const err = new Error(code);
    err.errorMessage = code;
    throw err;
}

async function precheckInvite(inviteLink) {
    const hash = extractInviteHash(inviteLink);
    if (!hash) return { ok: false, invalid: true };

    const { Api } = loadGramJs();
    return withClient(async (client) => {
        try {
            const checked = await client.invoke(new Api.messages.CheckChatInvite({ hash }));
            if (checked.className === 'ChatInviteAlready' && checked.chat) {
                return {
                    ok: true,
                    already: true,
                    chat: gramChatToBotChat(checked.chat),
                    title: checked.chat?.title,
                };
            }
            if (checked.className === 'ChatInvite') {
                if (checked.expired) return { ok: false, expired: true };
                const participantsCount = Number(
                    checked.participantsCount ??
                        checked.participants?.length ??
                        checked.participantCount ??
                        0
                );
                return {
                    ok: true,
                    title: checked.title,
                    participantsCount: Number.isFinite(participantsCount) ? participantsCount : 0,
                };
            }
            return { ok: false, reason: 'unknown' };
        } catch (e) {
            const msg = _gramErr(e).toUpperCase();
            if (msg.includes('INVITE_HASH_EXPIRED')) return { ok: false, expired: true };
            if (msg.includes('INVITE_HASH_INVALID')) return { ok: false, invalid: true };
            throw e;
        }
    });
}

async function userImportInvite(inviteLink) {
    const hash = extractInviteHash(inviteLink);
    if (!hash) throw new Error('Link + inválido');

    const { Api } = loadGramJs();
    return withClient(async (client) => {
        let checked;
        try {
            checked = await client.invoke(new Api.messages.CheckChatInvite({ hash }));
        } catch (e) {
            const msg = _gramErr(e).toUpperCase();
            if (msg.includes('INVITE_HASH_EXPIRED')) _throwInviteError('INVITE_HASH_EXPIRED');
            if (msg.includes('INVITE_HASH_INVALID')) _throwInviteError('INVITE_HASH_INVALID');
            throw e;
        }

        if (checked.className === 'ChatInviteAlready' && checked.chat) {
            _lastSource = 'check_invite_already';
            return {
                link: normalizeInviteLink(inviteLink),
                chat: gramChatToBotChat(checked.chat),
            };
        }

        if (checked.className === 'ChatInvite' && checked.expired) {
            _throwInviteError('INVITE_HASH_EXPIRED');
        }

        try {
            const updates = await client.invoke(new Api.messages.ImportChatInvite({ hash }));
            _lastSource = 'user_import_invite';
            logger.info('[UserBridge] ImportChatInvite OK');
            const fromUpdates = chatFromUpdates(updates);
            return { link: normalizeInviteLink(inviteLink), chat: fromUpdates };
        } catch (e) {
            const msg = _gramErr(e).toUpperCase();
            if (msg.includes('USER_ALREADY_PARTICIPANT')) {
                _lastSource = 'user_already_in';
                const chat = await resolveChatFromInvite(inviteLink);
                return { link: normalizeInviteLink(inviteLink), chat };
            }
            if (msg.includes('INVITE_HASH_EXPIRED')) _throwInviteError('INVITE_HASH_EXPIRED');
            throw e;
        }
    });
}

const {
    buildAddBotUrl,
    buildGroupInvitePitch,
    buildAdminInviteHint,
} = require('../telegram/botInviteCopy');

async function _userCanInviteUsers(client, channelInput) {
    const { Api } = loadGramJs();
    try {
        const me = await client.getMe();
        const res = await client.invoke(
            new Api.channels.GetParticipant({
                channel: channelInput,
                participant: me,
            })
        );
        const p = res.participant;
        if (p.className === 'ChannelParticipantCreator') return true;
        if (p.className === 'ChannelParticipantAdmin') {
            return !!(p.adminRights?.inviteUsers || p.adminRights?.addAdmins);
        }
        return false;
    } catch {
        return false;
    }
}

async function _userCanSendMessages(client, gramChat) {
    if (!gramChat?.id) return false;
    if (!['group', 'supergroup'].includes(gramChat.type)) return false;
    const { Api } = loadGramJs();
    const isBasicGroup = gramChat.type === 'group';

    let channelInput;
    try {
        const entityRef = gramChat.username ? `@${gramChat.username}` : gramChat.id;
        channelInput = await client.getInputEntity(entityRef);
    } catch {
        try {
            channelInput = await client.getInputEntity(gramChat.id);
        } catch {
            return false;
        }
    }

    if (isBasicGroup) {
        try {
            const chatId = BigInt(Math.abs(Number(gramChat.id)));
            const full = await client.invoke(new Api.messages.GetFullChat({ chatId }));
            const banned = full.fullChat?.defaultBannedRights;
            if (banned?.sendMessages) return false;
        } catch {
            return false;
        }
        return true;
    }

    try {
        const me = await client.getMe();
        const res = await client.invoke(
            new Api.channels.GetParticipant({
                channel: channelInput,
                participant: me,
            })
        );
        const p = res.participant;
        if (p.className === 'ChannelParticipantCreator') return true;
        if (p.className === 'ChannelParticipantBanned') return false;
        if (p.className === 'ChannelParticipantRestricted') {
            if (p.bannedRights?.sendMessages) return false;
        }
        if (p.className === 'ChannelParticipantAdmin') {
            return p.adminRights?.postMessages !== false;
        }
        if (gramChat.type === 'channel') {
            return false;
        }
    } catch {
        return false;
    }

    try {
        const full = await client.invoke(
            new Api.channels.GetFullChannel({ channel: channelInput })
        );
        const chat = full.chats?.[0];
        if (chat?.broadcast && !chat?.megagroup) return false;
        const banned = full.fullChat?.defaultBannedRights;
        if (banned?.sendMessages || banned?.sendPlain) return false;
        return true;
    } catch {
        return false;
    }
}

async function checkCanPostInChat(gramChat) {
    if (!isConfigured()) return false;
    return withClient((client) => _userCanSendMessages(client, gramChat));
}

async function getChatMemberCount(gramChat) {
    if (!gramChat?.id) return 0;
    if (!['group', 'supergroup', 'channel'].includes(gramChat.type)) return 0;
    const { Api } = loadGramJs();
    return withClient(async (client) => {
        if (gramChat.type === 'group') {
            try {
                const chatId = BigInt(Math.abs(Number(gramChat.id)));
                const full = await client.invoke(new Api.messages.GetFullChat({ chatId }));
                const count = full.fullChat?.participants?.participants?.length;
                if (Number.isFinite(count) && count > 0) return count;
            } catch {
                /* fallback channel API */
            }
        }
        let channelInput;
        try {
            const entityRef = gramChat.username ? `@${gramChat.username}` : gramChat.id;
            channelInput = await client.getInputEntity(entityRef);
        } catch {
            channelInput = await client.getInputEntity(gramChat.id);
        }
        const full = await client.invoke(new Api.channels.GetFullChannel({ channel: channelInput }));
        return Number(full.fullChat?.participantsCount || 0);
    });
}

async function isMemberOfChat(gramChat) {
    if (!gramChat?.id || !isConfigured()) return false;
    const { Api } = loadGramJs();
    return withClient(async (client) => {
        try {
            const me = await client.getMe();
            if (gramChat.type === 'group') {
                const chatId = BigInt(Math.abs(Number(gramChat.id)));
                await client.invoke(
                    new Api.messages.GetFullChat({ chatId })
                );
                return true;
            }
            let channelInput;
            try {
                const entityRef = gramChat.username ? `@${gramChat.username}` : gramChat.id;
                channelInput = await client.getInputEntity(entityRef);
            } catch {
                channelInput = await client.getInputEntity(gramChat.id);
            }
            await client.invoke(
                new Api.channels.GetParticipant({
                    channel: channelInput,
                    participant: me,
                })
            );
            return true;
        } catch (e) {
            const msg = _gramErr(e).toUpperCase();
            if (
                msg.includes('USER_NOT_PARTICIPANT') ||
                msg.includes('CHANNEL_PRIVATE') ||
                msg.includes('CHAT_ID_INVALID') ||
                msg.includes('PEER_ID_INVALID')
            ) {
                return false;
            }
            return false;
        }
    });
}

async function leaveChat(gramChat) {
    if (!gramChat?.id) return false;
    const { Api } = loadGramJs();
    return withClient(async (client) => {
        const me = await client.getMe();
        if (gramChat.type === 'group') {
            const chatId = BigInt(Math.abs(Number(gramChat.id)));
            await client.invoke(
                new Api.messages.DeleteChatUser({
                    chatId,
                    userId: me.id,
                    revokeHistory: false,
                })
            );
        } else {
            let channelInput;
            try {
                const entityRef = gramChat.username ? `@${gramChat.username}` : gramChat.id;
                channelInput = await client.getInputEntity(entityRef);
            } catch {
                channelInput = await client.getInputEntity(gramChat.id);
            }
            await client.invoke(new Api.channels.LeaveChannel({ channel: channelInput }));
        }
        logger.info(`[UserBridge] saiu do grupo ${gramChat.title || gramChat.id}`);
        return true;
    });
}

let _linkWatcherCb = null;
let _linkWatcherInstalled = false;

async function installBridgeLinkWatcher(onTextInChat) {
    if (!isConfigured() || typeof onTextInChat !== 'function') return false;
    _linkWatcherCb = onTextInChat;
    if (_linkWatcherInstalled) return true;

    const { NewMessage } = require('telegram/events');
    await withClient(async (client) => {
        client.addEventHandler(async (event) => {
            try {
                const msg = event.message;
                if (!msg?.message || msg.out) return;
                const peer = await msg.getChat();
                if (!peer?.id) return;
                const { gramChatToBotChat } = require('./inviteLinkUtils');
                const mapped = gramChatToBotChat(peer);
                if (!mapped?.id) return;
                await _linkWatcherCb(msg.message, mapped.id);
            } catch (e) {
                logger.debug('[UserBridge] linkWatcher:', e.message);
            }
        }, new NewMessage({}));
        _linkWatcherInstalled = true;
    });
    return true;
}

async function tryPostAddBotHint(gramChat, botTag) {
    try {
        const target = gramChat.username ? `@${gramChat.username}` : gramChat.id;
        const pitch = buildGroupInvitePitch(gramChat, botTag);
        await withClient(async (client) => {
            await client.sendMessage(target, {
                message: pitch.text,
                parseMode: 'html',
                linkPreview: true,
            });
        });
        logger.info('[UserBridge] divulgação Hanork postada no grupo');
        return true;
    } catch (e) {
        logger.debug('[UserBridge] post hint:', _gramErr(e));
        return false;
    }
}

async function tryAddBotToChat(client, gramChat, botTag) {
    const { Api } = loadGramJs();
    const isBasicGroup = gramChat?.type === 'group';

    let botPeer;
    try {
        botPeer = await client.getEntity(botTag);
    } catch (e) {
        throw new Error(`Bot @${botTag} não encontrado pela ponte: ${_gramErr(e)}`);
    }

    const entityRef = gramChat.username ? `@${gramChat.username}` : gramChat.id;
    let channelInput;
    try {
        channelInput = await client.getInputEntity(entityRef);
    } catch {
        channelInput = await client.getInputEntity(gramChat.id);
    }

    if (!isBasicGroup) {
        const canInvite = await _userCanInviteUsers(client, channelInput);
        if (!canInvite) {
            logger.debug('[UserBridge] sem permissão de admin para adicionar bot');
            return { added: false, reason: 'not_admin' };
        }
        try {
            await client.invoke(
                new Api.channels.InviteToChannel({
                    channel: channelInput,
                    users: [botPeer],
                })
            );
            _lastSource = 'invite_bot';
            logger.info(`[UserBridge] bot @${botTag} adicionado ao grupo`);
            return { added: true, reason: null };
        } catch (e) {
            const msg = _gramErr(e).toUpperCase();
            if (msg.includes('USER_ALREADY_PARTICIPANT')) {
                return { added: true, reason: 'already' };
            }
            logger.warn('[UserBridge] add bot:', { detail: _gramErr(e) });
            return {
                added: false,
                reason: msg.includes('CHAT_ADMIN_REQUIRED') ? 'not_admin' : 'failed',
            };
        }
    }

    const basicChatId = BigInt(Math.abs(Number(gramChat.id)));
    try {
        await client.invoke(
            new Api.messages.AddChatUser({
                chatId: basicChatId,
                userId: botPeer,
                fwdLimit: 0,
            })
        );
        _lastSource = 'invite_bot';
        logger.info(`[UserBridge] bot @${botTag} adicionado (grupo básico)`);
        return { added: true, reason: null };
    } catch (e) {
        const msg = _gramErr(e).toUpperCase();
        if (msg.includes('USER_ALREADY_PARTICIPANT')) {
            return { added: true, reason: 'already' };
        }
        logger.warn('[UserBridge] add bot (basic):', { detail: _gramErr(e) });
        return { added: false, reason: 'failed' };
    }
}

function _bridgeJoinReturn(gramChat, botTag, botAdded, link) {
    const pitch = buildGroupInvitePitch(gramChat, botTag);
    const { addBotUrl, shopUrl } = pitch;
    const adminHint = buildAdminInviteHint(gramChat, botTag, { postedInGroup: false, bridgePromo: !botAdded });
    return {
        chat: gramChat,
        botAdded,
        hint: botAdded ? null : adminHint.text,
        link,
        addBotUrl,
        shopUrl,
        postedInGroup: false,
    };
}

async function _resolveGramChatFromPrivateLink(client, parsed) {
    const { parsePrivateCLinkFull } = require('./inviteLinkUtils');
    const p = parsed?.chatId ? parsed : parsePrivateCLinkFull(parsed);
    if (!p?.chatId) throw new Error('Link t.me/c inválido');

    try {
        const entity = await client.getEntity(p.chatId);
        const mapped = gramChatToBotChat(entity);
        if (mapped?.id) return mapped;
    } catch (e) {
        if (!p.messageId) {
            throw new Error(
                'Grupo privado inacessível — sua conta MTProto precisa estar no grupo, ou use link com /msgId.'
            );
        }
    }

    if (p.messageId) {
        const msgs = await client.getMessages(p.chatId, { ids: [p.messageId] });
        const msg = Array.isArray(msgs) ? msgs[0] : msgs;
        if (!msg) {
            throw new Error(
                'Mensagem não encontrada — confirme que sua conta está no grupo e o link está correto.'
            );
        }
        const peer = msg.peerId || p.chatId;
        const entity = await client.getEntity(peer);
        const mapped = gramChatToBotChat(entity);
        if (mapped?.id) return mapped;
    }

    throw new Error('Não consegui resolver o grupo privado pelo link t.me/c.');
}

async function resolvePrivateCLinkChat(link) {
    const { parsePrivateCLinkFull } = require('./inviteLinkUtils');
    const parsed = parsePrivateCLinkFull(link);
    if (!parsed) throw new Error('Link t.me/c inválido');
    return withClient(async (client) => _resolveGramChatFromPrivateLink(client, parsed));
}

/**
 * Grupo/canal privado via t.me/c/ID ou t.me/c/ID/msg — conta MTProto precisa ter acesso.
 */
async function joinPrivateCLinkAndInviteBot(link, botUsername) {
    const { parsePrivateCLinkFull } = require('./inviteLinkUtils');
    const parsed = parsePrivateCLinkFull(link);
    if (!parsed) throw new Error('Link t.me/c inválido');
    return joinChatByIdAndInviteBot(parsed.chatId, botUsername, { displayLink: link, parsed });
}

/**
 * Resolve chat pelo ID (-100…) via MTProto e tenta adicionar o bot.
 */
async function joinChatByIdAndInviteBot(chatId, botUsername, { displayLink = null, parsed = null } = {}) {
    const botTag = String(botUsername || process.env.BOT_USERNAME || 'hanork_bot').replace(/^@/, '');
    const link = displayLink || String(chatId);
    let gramChat = null;
    let botAdded = false;

    await withClient(async (client) => {
        if (parsed?.internalId || parsed?.messageId) {
            gramChat = await _resolveGramChatFromPrivateLink(client, parsed);
        } else {
            const entity = await client.getEntity(Number(chatId));
            gramChat = gramChatToBotChat(entity);
        }
        if (!gramChat?.id) throw new Error('Não obtive dados do chat.');
        _lastSource = parsed?.messageId ? 'resolve_c_msg' : 'resolve_chat_id';
        const result = await tryAddBotToChat(client, gramChat, botTag);
        botAdded = result.added;
    });

    return _bridgeJoinReturn(gramChat, botTag, botAdded, link);
}

async function joinGroupAndInviteBot(inviteLink, botUsername) {
    const link = normalizeInviteLink(inviteLink);
    const imported = await userImportInvite(link);

    let gramChat = imported.chat || (await resolveChatFromInvite(link));
    if (!gramChat?.id) {
        throw new Error('Entrei no convite, mas não consegui obter o ID do grupo.');
    }

    const botTag = String(botUsername || process.env.BOT_USERNAME || 'hanork_bot').replace(/^@/, '');
    const pitch = buildGroupInvitePitch(gramChat, botTag);
    const { addBotUrl, shopUrl } = pitch;

    let botAdded = false;
    await withClient(async (client) => {
        const result = await tryAddBotToChat(client, gramChat, botTag);
        botAdded = result.added;
    });

    gramChat = (await resolveChatFromInvite(link)) || gramChat;

    const adminHint = buildAdminInviteHint(gramChat, botTag, { postedInGroup: false, bridgePromo: !botAdded });
    const hint = botAdded ? null : adminHint.text;

    return { chat: gramChat, botAdded, hint, link, addBotUrl, shopUrl, postedInGroup: false };
}

/**
 * Entra em supergrupo/canal público pelo @username (JoinChannel).
 */
async function joinPublicAndInviteBot(username, botUsername) {
    const slug = String(username || '')
        .replace(/^@/, '')
        .trim();
    if (!slug) throw new Error('Username inválido');

    const botTag = String(botUsername || process.env.BOT_USERNAME || 'hanork_bot').replace(/^@/, '');
    const { Api } = loadGramJs();

    let gramChat = null;
    let botAdded = false;

    await withClient(async (client) => {
        let entity;
        try {
            entity = await client.getEntity(slug);
        } catch (e) {
            throw new Error(_gramErr(e) || 'USERNAME_INVALID');
        }
        if (entity.className === 'User') {
            throw new Error('USERNAME_NOT_A_GROUP');
        }

        try {
            if (entity.className === 'Chat') {
                _lastSource = 'join_basic_chat';
            } else {
                await client.invoke(new Api.channels.JoinChannel({ channel: entity }));
                _lastSource = 'join_channel';
            }
        } catch (e) {
            const msg = _gramErr(e).toUpperCase();
            if (!msg.includes('USER_ALREADY_PARTICIPANT')) {
                throw e;
            }
            _lastSource = 'join_channel_already';
        }

        if (!entity || entity.className === 'User') {
            throw new Error('USERNAME_NOT_A_GROUP');
        }
        gramChat = gramChatToBotChat(entity);
        if (!gramChat?.id) throw new Error('Não obtive dados do grupo/canal.');

        const result = await tryAddBotToChat(client, gramChat, botTag);
        botAdded = result.added;
    });

    const pitch = buildGroupInvitePitch(gramChat, botTag);
    const { addBotUrl, shopUrl } = pitch;
    const adminHint = buildAdminInviteHint(gramChat, botTag, { postedInGroup: false, bridgePromo: !botAdded });
    const hint = botAdded ? null : adminHint.text;

    return {
        chat: gramChat,
        botAdded,
        hint,
        link: `https://t.me/${slug}`,
        addBotUrl,
        shopUrl,
        postedInGroup: false,
    };
}

async function discoverInviteLink(slug) {
    const username = String(slug || '')
        .replace(/^@/, '')
        .trim();
    if (!username) return null;

    _lastSource = null;
    const { Api } = loadGramJs();

    return withClient(async (client) => {
        let entity;
        try {
            entity = await client.getEntity(username);
        } catch (e) {
            logger.debug(`[UserBridge] resolve @${username}:`, e.message);
            return null;
        }
        if (entity.className === 'User') return null;

        try {
            if (entity.className !== 'Chat') {
                await client.invoke(new Api.channels.JoinChannel({ channel: entity }));
            }
        } catch (e) {
            const msg = String(e.message || '').toUpperCase();
            if (!msg.includes('USER_ALREADY_PARTICIPANT')) {
                logger.debug(`[UserBridge] JoinChannel @${username}:`, e.message);
            }
        }

        try {
            const full = await client.invoke(new Api.channels.GetFullChannel({ channel: entity }));
            const inv = full?.fullChat?.exportedInvite?.link;
            if (inv?.includes('t.me')) {
                _lastSource = 'exported_invite';
                return inv;
            }
        } catch (e) {
            logger.debug('[UserBridge] GetFullChannel:', e.message);
        }

        const msgs = await client.getMessages(entity, { limit: 300 });
        for (const msg of msgs) {
            const found = extractPlusFromText(msg.message);
            if (found) {
                _lastSource = 'message_scan';
                return found;
            }
        }
        return null;
    });
}

function getLastSource() {
    return _lastSource;
}

async function validateSession() {
    if (!isConfigured()) return false;
    try {
        await withClient(async (client) => {
            if (!(await client.checkAuthorization())) {
                throw new Error('Sessão não autorizada');
            }
        });
        return true;
    } catch (e) {
        logger.warn('[UserBridge] validateSession:', e.message);
        clearSession();
        await resetClient();
        return false;
    }
}

function maskPhone(phone) {
    const digits = String(phone || '').replace(/\D/g, '');
    if (!digits) return null;
    if (digits.length < 8) return `+${digits}`;
    return `+${digits.slice(0, 2)} *** *** ${digits.slice(-4)}`;
}

/** Dados da conta MTProto conectada (número que divulga nos grupos ponte). */
async function getAccountInfo() {
    if (!canUseBridge()) {
        return { available: false, connected: false, configured: false };
    }
    if (!isConfigured()) {
        return { available: true, connected: false, configured: false };
    }
    try {
        return await withClient(async (client) => {
            const me = await client.getMe();
            const phone = me.phone || null;
            const firstName = me.firstName || me.first_name || '';
            const lastName = me.lastName || me.last_name || '';
            const username = me.username || null;
            return {
                available: true,
                connected: true,
                configured: true,
                userId: me.id != null ? String(me.id) : null,
                username,
                firstName,
                lastName,
                phone,
                phoneMasked: maskPhone(phone),
                displayName: [firstName, lastName].filter(Boolean).join(' ') || username || phone || 'Conta MTProto',
            };
        });
    } catch (e) {
        return {
            available: true,
            connected: false,
            configured: true,
            error: e.message,
        };
    }
}

function setupHelpHtml() {
    if (!canUseBridge()) {
        return (
            '<b>🔌 Ponte MTProto (opcional)</b>\n\n' +
            'Pacote <code>telegram</code> não instalado.\n' +
            'O resto do bot funciona normalmente.'
        );
    }
    if (!hasCredentials()) {
        return (
            '<b>🔌 Credenciais API</b>\n\n' +
            'Coloque <code>TELEGRAM_USER_API_ID</code> e <code>TELEGRAM_USER_API_HASH</code> no .env.\n' +
            'Sem ponte: use @nome público ou peça admin adicionar o bot.'
        );
    }
    if (!isConfigured()) {
        return (
            '<b>📲 Conectar conta (1ª vez)</b>\n\n' +
            'Digite <code>/conectar</code> — escaneie o <b>QR code</b> no Telegram.\n' +
            '<i>Não digite código SMS no bot.</i>'
        );
    }
    return '✅ Ponte ativa — <code>/entrar</code> funciona em links +, @nome e ID.';
}

module.exports = {
    setDbRaw,
    isGramJsInstalled,
    hasCredentials,
    canUseBridge,
    isConfigured,
    isReady,
    validateSession,
    getAccountInfo,
    maskPhone,
    getCredentials,
    saveCredentials,
    getSessionString,
    saveSession,
    clearSession,
    resetClient,
    destroyClient,
    getClientOptions,
    isJoinChatApiMissing,
    discoverInviteLink,
    resolveChatFromInvite,
    precheckInvite,
    userImportInvite,
    joinGroupAndInviteBot,
    joinPublicAndInviteBot,
    joinPrivateCLinkAndInviteBot,
    joinChatByIdAndInviteBot,
    resolvePrivateCLinkChat,
    checkCanPostInChat,
    getChatMemberCount,
    isMemberOfChat,
    leaveChat,
    installBridgeLinkWatcher,
    withClient,
    getLastSource,
    setupHelpHtml,
};
