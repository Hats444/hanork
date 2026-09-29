'use strict';

const assert = (cond, msg) => {
    if (!cond) throw new Error(msg);
};

const {
    classifyTelegramUpdate,
    SYSTEM_EVENT_TYPES,
    shouldRunAntiSpam,
} = require('../src/telegram/events/TelegramEventClassifier');

function ctxFrom(update) {
    const ctx = {
        update,
        from: update.message?.from || update.callback_query?.from || update.edited_message?.from,
        chat: update.message?.chat || update.callback_query?.message?.chat || update.edited_message?.chat,
        message: update.message,
        editedMessage: update.edited_message,
        callbackQuery: update.callback_query,
        chatMember: update.chat_member,
        myChatMember: update.my_chat_member,
        channelPost: update.channel_post,
    };
    ctx.telegramEvent = classifyTelegramUpdate(ctx);
    return ctx;
}

console.log('=== Telegram Event Classifier ===\n');

const newMember = classifyTelegramUpdate(
    ctxFrom({
        message: {
            message_id: 1,
            date: 1,
            chat: { id: -1001, type: 'supergroup', title: 'HANORK' },
            from: { id: 99, first_name: 'Admin' },
            new_chat_members: [{ id: 123, first_name: 'User', is_bot: false }],
        },
    })
);
assert(newMember.eventType === 'new_member', 'new_member type');
assert(newMember.skipUserPipeline === true, 'new_member skips pipeline');
assert(newMember.isRealUserMessage === false, 'new_member not real message');
assert(newMember.isSuperGroup === true, 'supergroup flag');
console.log('  new_member: OK');

const leftMember = classifyTelegramUpdate(
    ctxFrom({
        message: {
            message_id: 2,
            chat: { id: -1001, type: 'supergroup', title: 'HANORK' },
            from: { id: 123, first_name: 'User' },
            left_chat_member: { id: 123, first_name: 'User', is_bot: false },
        },
    })
);
assert(leftMember.eventType === 'left_member', 'left_member type');
assert(leftMember.skipUserPipeline === true, 'left_member skips');
console.log('  left_member: OK');

const privateMsg = classifyTelegramUpdate(
    ctxFrom({
        message: {
            message_id: 3,
            chat: { id: 456, type: 'private' },
            from: { id: 456, first_name: 'João' },
            text: 'Olá',
        },
    })
);
assert(privateMsg.eventType === 'message', 'private message');
assert(privateMsg.route === 'private', 'private route');
assert(privateMsg.isRealUserMessage === true, 'real user message');
assert(privateMsg.isPrivate === true, 'isPrivate');
console.log('  private message: OK');

const groupText = classifyTelegramUpdate(
    ctxFrom({
        message: {
            message_id: 4,
            chat: { id: -1001, type: 'supergroup', title: 'GP' },
            from: { id: 789, first_name: 'Ana' },
            text: 'oi pessoal',
        },
    })
);
assert(groupText.eventType === 'message', 'group message');
assert(groupText.route === 'group', 'group route');
assert(groupText.skipUserPipeline === false, 'group text not system');
console.log('  group message: OK');

const cmd = classifyTelegramUpdate(
    ctxFrom({
        message: {
            message_id: 5,
            chat: { id: 456, type: 'private' },
            from: { id: 456 },
            text: '/start',
            entities: [{ type: 'bot_command', offset: 0, length: 6 }],
        },
    })
);
assert(cmd.eventType === 'command', 'command type');
assert(cmd.isRealUserMessage === true, 'command is real');
console.log('  command: OK');

const cb = classifyTelegramUpdate(
    ctxFrom({
        callback_query: {
            id: '1',
            from: { id: 456 },
            message: { chat: { id: 456, type: 'private' }, message_id: 9 },
            data: 'cat',
        },
    })
);
assert(cb.eventType === 'callback_query', 'callback');
assert(cb.route === 'callback', 'callback route');
console.log('  callback_query: OK');

assert(SYSTEM_EVENT_TYPES.has('new_member'), 'taxonomy has new_member');

const edited = classifyTelegramUpdate(
    ctxFrom({
        edited_message: {
            message_id: 10,
            chat: { id: 456, type: 'private' },
            from: { id: 456, first_name: 'João' },
            text: 'Olá editado',
        },
    })
);
assert(edited.eventType === 'edited_message', 'edited_message type');
assert(edited.isRealUserMessage === true, 'edited is real');
console.log('  edited_message: OK');

const photoNoCaption = ctxFrom({
    message: {
        message_id: 11,
        chat: { id: 456, type: 'private' },
        from: { id: 456 },
        photo: [{ file_id: 'x', width: 100, height: 100 }],
    },
});
assert(shouldRunAntiSpam(photoNoCaption) === false, 'anti-spam skip photo without caption');
console.log('  anti-spam skip photo: OK');

const textMsg = ctxFrom({
    message: {
        message_id: 12,
        chat: { id: 456, type: 'private' },
        from: { id: 456 },
        text: 'spam test',
    },
});
assert(shouldRunAntiSpam(textMsg) === true, 'anti-spam on text');
console.log('  anti-spam on text: OK');

const joinNoAntiSpam = ctxFrom({
    message: {
        message_id: 13,
        chat: { id: -1001, type: 'supergroup', title: 'GP' },
        from: { id: 99 },
        new_chat_members: [{ id: 123, first_name: 'Novo' }],
    },
});
assert(shouldRunAntiSpam(joinNoAntiSpam) === false, 'anti-spam skip new_member');
console.log('  anti-spam skip join: OK');

console.log('\nRESULT: OK');
