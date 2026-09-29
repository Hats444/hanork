'use strict';

const assert = (cond, msg) => {
    if (!cond) throw new Error(msg);
};

const { createTelegramEventAuditService } = require('../src/services/TelegramEventAuditService');

const rows = [];
const mockDb = {
    prepare(sql) {
        return {
            run(...args) {
                if (sql.includes('INSERT INTO telegram_event_audit')) {
                    rows.push({
                        id: rows.length + 1,
                        event_type: args[0],
                        route: args[1],
                        route_executed: args[2],
                        chat_id: args[3],
                        chat_type: args[4],
                        chat_title: args[5],
                        user_id: args[6],
                        username: args[7],
                        first_name: args[8],
                        message_id: args[9],
                        message_text: args[10],
                        callback_data: args[11],
                        skip_user_pipeline: args[12],
                        is_real_user_message: args[13],
                        is_private: args[14],
                        is_group: args[15],
                        is_supergroup: args[16],
                        is_channel: args[17],
                        is_debug: args[18],
                        event_ts: args[19],
                    });
                }
            },
            all(...args) {
                if (sql.includes('event_type = ?')) {
                    const type = args[0];
                    const limit = args[1];
                    return rows.filter((r) => r.event_type === type).slice(-limit).reverse();
                }
                const limit = args[0];
                return rows.slice(-limit).reverse();
            },
        };
    },
};

const audit = createTelegramEventAuditService(() => mockDb);

audit.insert({
    eventType: 'new_member',
    route: 'system',
    chatId: -100123456789,
    chatType: 'supergroup',
    chatTitle: 'HANORK',
    userId: 123456789,
    username: 'testuser',
    firstName: 'Test',
    messageId: 1,
    skipUserPipeline: true,
    isRealUserMessage: false,
    isSuperGroup: true,
    timestamp: 1750320000,
});

const joinRows = audit.byEventType('new_member', 5);
assert(joinRows.length === 1, 'one row inserted');
assert(joinRows[0].event_type === 'new_member', 'event_type column');
assert(joinRows[0].chat_id === '-100123456789', 'chat_id column');
assert(joinRows[0].chat_title === 'HANORK', 'chat_title column');
assert(joinRows[0].user_id === '123456789', 'user_id column');
assert(joinRows[0].skip_user_pipeline === 1, 'skip flag');
assert(joinRows[0].event_ts === 1750320000, 'event_ts column');

audit.insert({
    eventType: 'message',
    route: 'private',
    chatId: 123456789,
    chatType: 'private',
    userId: 123456789,
    text: 'Olá',
    isRealUserMessage: true,
    isPrivate: true,
    timestamp: 1750320001,
});

const msgRows = audit.recent(10);
assert(msgRows[0].event_type === 'message', 'latest message');
assert(msgRows[0].message_text === 'Olá', 'message_text stored');

console.log('=== Telegram Event Audit (DB) ===');
console.log('RESULT: OK');
