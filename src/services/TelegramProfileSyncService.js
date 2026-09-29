'use strict';

const logger = require('../config/logger');
const { prisma } = require('../config/database-sqlite');
const dbRaw = require('../config/database-sqlite').connect;

const DEFAULT_BATCH = 40;
const DELAY_MS = 100;

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function envNumber(name, fallback) {
    const n = Number(process.env[name]);
    return Number.isFinite(n) ? n : fallback;
}

async function fetchTelegramProfile(bot, telegramId) {
    try {
        const chat = await bot.telegram.getChat(telegramId);
        let photoFileId = null;
        try {
            const photos = await bot.telegram.getUserProfilePhotos(telegramId, { limit: 1 });
            const sizes = photos?.photos?.[0];
            if (sizes?.length) {
                photoFileId = sizes[sizes.length - 1].file_id;
            }
        } catch {
            /* privacidade ou sem foto */
        }

        return {
            ok: true,
            first_name: chat.first_name || '',
            last_name: chat.last_name || '',
            username: chat.username || '',
            language_code: chat.language_code || '',
            is_premium: chat.is_premium ? 1 : 0,
            photo_file_id: photoFileId,
        };
    } catch (e) {
        const msg = String(e.message || e.description || '');
        if (/chat not found|user not found|blocked|deactivated|PEER_ID_INVALID/i.test(msg)) {
            return { ok: false, skip: true, reason: 'unreachable' };
        }
        return { ok: false, error: msg };
    }
}

function profileChanged(user, profile) {
    return (
        (profile.first_name !== undefined && profile.first_name !== (user.first_name || '')) ||
        (profile.last_name !== undefined && profile.last_name !== (user.last_name || '')) ||
        (profile.username !== undefined && profile.username !== (user.username || '')) ||
        (profile.language_code !== undefined && profile.language_code !== (user.language_code || '')) ||
        Number(profile.is_premium || 0) !== Number(user.is_premium || 0) ||
        (profile.photo_file_id && profile.photo_file_id !== (user.photo_file_id || ''))
    );
}

async function applyProfileUpdate(user, profile) {
    const data = {};
    if (profile.first_name !== undefined) data.first_name = profile.first_name;
    if (profile.last_name !== undefined) data.last_name = profile.last_name;
    if (profile.username !== undefined) data.username = profile.username;
    if (profile.language_code !== undefined) data.language_code = profile.language_code || null;
    if (profile.is_premium !== undefined) data.is_premium = profile.is_premium;
    if (profile.photo_file_id) data.photo_file_id = profile.photo_file_id;

    if (!Object.keys(data).length) return false;

    await prisma.user.update({
        where: { id: user.id },
        data,
    });
    return true;
}

async function syncUserProfile(bot, telegramId) {
    const user = await prisma.user.findUnique({ where: { telegram_id: String(telegramId) } });
    if (!user) return { ok: false, reason: 'not_found' };

    const profile = await fetchTelegramProfile(bot, telegramId);
    if (!profile.ok) return profile;

    if (!profileChanged(user, profile)) {
        return { ok: true, updated: false };
    }

    await applyProfileUpdate(user, profile);
    return { ok: true, updated: true };
}

async function syncAllUsers(bot, options = {}) {
    const batchSize = options.batchSize || envNumber('TELEGRAM_PROFILE_SYNC_BATCH', DEFAULT_BATCH);
    const delayMs = options.delayMs || envNumber('TELEGRAM_PROFILE_SYNC_DELAY_MS', DELAY_MS);
    const log = options.log || logger;

    const users = dbRaw()
        .prepare(
            `SELECT id, telegram_id, first_name, last_name, username, is_premium, language_code, photo_file_id
             FROM users
             WHERE telegram_id IS NOT NULL AND TRIM(telegram_id) != ''
             ORDER BY id`
        )
        .all();

    let updated = 0;
    let unchanged = 0;
    let unreachable = 0;
    let failed = 0;

    for (let i = 0; i < users.length; i++) {
        const user = users[i];
        const profile = await fetchTelegramProfile(bot, user.telegram_id);

        if (!profile.ok) {
            if (profile.skip) unreachable++;
            else failed++;
        } else if (profileChanged(user, profile)) {
            await applyProfileUpdate(user, profile);
            updated++;
        } else {
            unchanged++;
        }

        if (delayMs > 0 && i < users.length - 1) {
            await sleep(delayMs);
        }

        if (batchSize > 0 && (i + 1) % batchSize === 0) {
            log.info('[PROFILE:SYNC] progresso', {
                done: i + 1,
                total: users.length,
                updated,
                unchanged,
                unreachable,
                failed,
            });
        }
    }

    const summary = {
        total: users.length,
        updated,
        unchanged,
        unreachable,
        failed,
    };
    log.info('[PROFILE:SYNC] concluído', summary);
    return summary;
}

module.exports = {
    fetchTelegramProfile,
    syncUserProfile,
    syncAllUsers,
};
