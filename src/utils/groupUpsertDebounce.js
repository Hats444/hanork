'use strict';

const DEFAULT_GROUP_MS = Number(process.env.GROUP_UPSERT_DEBOUNCE_MS) || 8000;
const DEFAULT_MEMBER_MS = Number(process.env.GROUP_MEMBER_UPSERT_DEBOUNCE_MS) || 15000;

function chatKey(chat) {
    return String(chat?.id ?? '');
}

function memberKey(chatId, user) {
    return `${String(chatId)}:${String(user?.id ?? '')}`;
}

function createGroupUpsertDebouncer(options = {}) {
    const groupMs = Math.max(1000, Number(options.groupMs) || DEFAULT_GROUP_MS);
    const memberMs = Math.max(1000, Number(options.memberMs) || DEFAULT_MEMBER_MS);
    const pendingGroups = new Map();
    const pendingMembers = new Map();

    function scheduleGroup(chat, botIsAdmin, run) {
        const key = chatKey(chat);
        if (!key) {
            run();
            return;
        }
        const prev = pendingGroups.get(key);
        if (prev?.timer) clearTimeout(prev.timer);
        const entry = {
            chat,
            botIsAdmin,
            run,
            timer: setTimeout(() => {
                pendingGroups.delete(key);
                try {
                    run();
                } catch {
                    /* ignore */
                }
            }, groupMs),
        };
        if (entry.timer.unref) entry.timer.unref();
        pendingGroups.set(key, entry);
    }

    function scheduleMember(chatId, user, role, run) {
        const key = memberKey(chatId, user);
        if (!key || key.endsWith(':')) {
            run();
            return;
        }
        const prev = pendingMembers.get(key);
        if (prev?.timer) clearTimeout(prev.timer);
        const entry = {
            timer: setTimeout(() => {
                pendingMembers.delete(key);
                try {
                    run();
                } catch {
                    /* ignore */
                }
            }, memberMs),
        };
        if (entry.timer.unref) entry.timer.unref();
        pendingMembers.set(key, entry);
    }

    return { scheduleGroup, scheduleMember };
}

module.exports = { createGroupUpsertDebouncer, DEFAULT_GROUP_MS, DEFAULT_MEMBER_MS };
