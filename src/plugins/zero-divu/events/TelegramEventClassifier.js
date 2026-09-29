'use strict';

/**
 * Classificador central de updates Telegram — roteamento consciente de contexto.
 * Todo update passa por classifyTelegramUpdate antes do pipeline de usuário.
 */

const SYSTEM_EVENT_TYPES = new Set([
    'new_member',
    'left_member',
    'bot_membership',
    'member_status',
    'chat_title_changed',
    'chat_photo_changed',
    'chat_migrate',
    'topic_created',
    'topic_closed',
    'topic_reopened',
    'join_request',
    'channel_post',
    'pinned_message',
    'group_chat_created',
    'supergroup_chat_created',
]);

function chatContext(chat) {
    const type = chat?.type || 'unknown';
    return {
        chatId: chat?.id ?? null,
        chatType: type,
        chatTitle: chat?.title || chat?.username || null,
        isPrivate: type === 'private',
        isGroup: type === 'group',
        isSuperGroup: type === 'supergroup',
        isChannel: type === 'channel',
    };
}

function userContext(from) {
    if (!from) {
        return {
            userId: null,
            username: null,
            firstName: null,
            isBot: false,
        };
    }
    return {
        userId: from.id ?? null,
        username: from.username || null,
        firstName: from.first_name || null,
        isBot: !!from.is_bot,
    };
}

function classifyMessageEvent(msg, { edited = false } = {}) {
    if (!msg) return null;

    if (msg.new_chat_members?.length) return 'new_member';
    if (msg.left_chat_member) return 'left_member';
    if (msg.new_chat_title) return 'chat_title_changed';
    if (msg.new_chat_photo || msg.delete_chat_photo) return 'chat_photo_changed';
    if (msg.migrate_to_chat_id || msg.migrate_from_chat_id) return 'chat_migrate';
    if (msg.forum_topic_created) return 'topic_created';
    if (msg.forum_topic_closed) return 'topic_closed';
    if (msg.forum_topic_reopened) return 'topic_reopened';
    if (msg.pinned_message) return 'pinned_message';
    if (msg.group_chat_created) return 'group_chat_created';
    if (msg.supergroup_chat_created) return 'supergroup_chat_created';

    if (msg.text) {
        const isCmd =
            msg.text.startsWith('/') ||
            (msg.entities || []).some((e) => e.type === 'bot_command');
        if (isCmd) return 'command';
        return edited ? 'edited_message' : 'message';
    }
    if (msg.photo?.length) return 'photo';
    if (msg.video || msg.video_note) return 'video';
    if (msg.document) return 'document';
    if (msg.sticker) return 'sticker';
    if (msg.voice) return 'voice';
    if (msg.audio) return 'audio';
    if (msg.contact) return 'contact';
    if (msg.location) return 'location';
    if (msg.animation) return 'animation';

    return 'other';
}

function classifyMemberStatus(update) {
    const status = update?.new_chat_member?.status;
    const old = update?.old_chat_member?.status;
    if (status === 'left' || status === 'kicked') return 'left_member';
    if (
        (status === 'member' || status === 'administrator' || status === 'creator') &&
        (old === 'left' || old === 'kicked' || !old)
    ) {
        return 'new_member';
    }
    return 'member_status';
}

/**
 * @param {import('telegraf').Context} ctx
 * @returns {object} ctx.telegramEvent shape
 */
function classifyTelegramUpdate(ctx) {
    const chat =
        ctx.chat ||
        ctx.callbackQuery?.message?.chat ||
        ctx.editedMessage?.chat;
    const from =
        ctx.from ||
        ctx.callbackQuery?.from ||
        ctx.message?.from ||
        ctx.editedMessage?.from ||
        ctx.chatMember?.new_chat_member?.user;

    const cc = chatContext(chat);
    const uc = userContext(from);
    let eventType = 'other';
    let route = 'system';
    let messageId = null;
    let text = null;

    if (ctx.callbackQuery) {
        eventType = 'callback_query';
        route = 'callback';
        messageId = ctx.callbackQuery.message?.message_id ?? null;
    } else if (ctx.myChatMember) {
        eventType = 'bot_membership';
        route = 'bot_membership';
    } else if (ctx.chatMember) {
        eventType = classifyMemberStatus(ctx.chatMember);
        route = 'member_status';
    } else if (ctx.channelPost) {
        eventType = 'channel_post';
        route = 'channel';
        messageId = ctx.channelPost.message_id ?? null;
        text = ctx.channelPost.text || ctx.channelPost.caption || null;
    } else if (ctx.chatJoinRequest) {
        eventType = 'join_request';
        route = 'join_request';
    } else if (ctx.editedMessage) {
        eventType = classifyMessageEvent(ctx.editedMessage, { edited: true });
        messageId = ctx.editedMessage.message_id ?? null;
        text = ctx.editedMessage.text || ctx.editedMessage.caption || null;
        route = SYSTEM_EVENT_TYPES.has(eventType) ? 'system' : cc.isPrivate ? 'private' : 'group';
    } else if (ctx.message) {
        eventType = classifyMessageEvent(ctx.message);
        messageId = ctx.message.message_id ?? null;
        text = ctx.message.text || ctx.message.caption || null;
        route = SYSTEM_EVENT_TYPES.has(eventType) ? 'system' : cc.isPrivate ? 'private' : 'group';
    }

    const skipUserPipeline = SYSTEM_EVENT_TYPES.has(eventType) || eventType === 'bot_membership';
    const isRealUserMessage =
        !skipUserPipeline &&
        !uc.isBot &&
        !!from &&
        (eventType === 'message' ||
            eventType === 'edited_message' ||
            eventType === 'command' ||
            eventType === 'photo' ||
            eventType === 'video' ||
            eventType === 'document' ||
            eventType === 'sticker' ||
            eventType === 'voice' ||
            eventType === 'audio' ||
            eventType === 'callback_query');

    return {
        eventType,
        route,
        skipUserPipeline,
        isRealUserMessage,
        messageId,
        text: text != null ? String(text).slice(0, 200) : null,
        timestamp: Math.floor(Date.now() / 1000),
        ...cc,
        ...uc,
    };
}

function isSystemTelegramEvent(ctx) {
    if (ctx.telegramEvent) return ctx.telegramEvent.skipUserPipeline;
    return SYSTEM_EVENT_TYPES.has(classifyTelegramUpdate(ctx).eventType);
}

/** Bloqueia pipeline de usuário (menus, IA, vendas, atendimento). */
function shouldSkipUserPipeline(ctx) {
    return isSystemTelegramEvent(ctx);
}

/**
 * Anti-spam só em mensagens reais com texto ou legenda — nunca em entradas/saídas ou mídia sem legenda.
 */
function shouldRunAntiSpam(ctx) {
    if (shouldSkipUserPipeline(ctx)) return false;
    if (ctx.from?.is_bot) return false;
    if (ctx.callbackQuery) return false;

    const msg = ctx.message || ctx.editedMessage;
    if (!msg) return false;

    const text = String(msg.text || msg.caption || '').trim();
    if (!text) return false;

    const meta = ctx.telegramEvent;
    if (meta && !meta.isRealUserMessage) return false;

    return true;
}

module.exports = {
    classifyTelegramUpdate,
    isSystemTelegramEvent,
    shouldSkipUserPipeline,
    shouldRunAntiSpam,
    SYSTEM_EVENT_TYPES,
    chatContext,
    userContext,
};
