'use strict';

/**
 * B3 — eventos de grupo/canal Telegram (move-only de bot.js).
 */
const { createGroupUpsertDebouncer } = require('../../utils/groupUpsertDebounce');

function createGroupHelpers(deps) {
    const { dbRaw, logger, groupService } = deps;
    const debouncer = createGroupUpsertDebouncer();

    function upsertGroupNow(chat, botIsAdmin = 0) {
        if (groupService) {
            groupService.upsertGroup(chat, botIsAdmin);
            return;
        }
        try {
            const db = dbRaw();
            db.prepare(`
            INSERT INTO telegram_groups (chat_id, title, type, username, bot_is_admin, updated_at)
            VALUES (?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(chat_id) DO UPDATE SET
                title=excluded.title, type=excluded.type,
                username=excluded.username, bot_is_admin=excluded.bot_is_admin,
                updated_at=datetime('now'), active=1
        `).run(String(chat.id), chat.title || 'Grupo', chat.type, chat.username || null, botIsAdmin);
        } catch (e) { logger.warn('[GROUP] upsertGroup error: ' + e.message); }
    }

    function upsertGroupMemberNow(chatId, user, role = 'member') {
        try {
            const db = dbRaw();
            const dbUser = db.prepare('SELECT id FROM users WHERE telegram_id=?').get(String(user.id));
            const userId = dbUser?.id || 0;
            db.prepare(`
            INSERT INTO group_members (group_chat_id, user_id, telegram_id, username, first_name, role, last_seen_at, active)
            VALUES (?, ?, ?, ?, ?, ?, datetime('now'), 1)
            ON CONFLICT(group_chat_id, telegram_id) DO UPDATE SET
                username=excluded.username, first_name=excluded.first_name,
                role=excluded.role, last_seen_at=datetime('now'), active=1
        `).run(String(chatId), userId, String(user.id), user.username || null, user.first_name || null, role);
        } catch (e) { logger.warn('[GROUP] upsertGroupMember error: ' + e.message); }
    }

    function upsertGroup(chat, botIsAdmin = 0, opts = {}) {
        if (opts.immediate) {
            upsertGroupNow(chat, botIsAdmin);
            return;
        }
        debouncer.scheduleGroup(chat, botIsAdmin, () => upsertGroupNow(chat, botIsAdmin));
    }

    function upsertGroupMember(chatId, user, role = 'member', opts = {}) {
        if (opts.immediate) {
            upsertGroupMemberNow(chatId, user, role);
            return;
        }
        debouncer.scheduleMember(chatId, user, role, () => upsertGroupMemberNow(chatId, user, role));
    }

    return { upsertGroup, upsertGroupMember };
}

function registerGroupEvents(bot, deps) {
    const {
        CONFIG, logger, dbRaw, Markup, loadProducts, getVipGroupId, bot: telegramBot,
        upsertGroup, upsertGroupMember,
    } = deps;

    bot.on('my_chat_member', async (ctx) => {
        try {
            const update = ctx.myChatMember;
            if (!update) return;
            const { chat, new_chat_member } = update;
            const isChannel = chat.type === 'channel';
            if (chat.type !== 'group' && chat.type !== 'supergroup' && !isChannel) return;
            const status = new_chat_member?.status;

            if (isChannel) {
                if (status === 'administrator') {
                    const canPost = new_chat_member.can_post_messages !== false ? 1 : 0;
                    upsertGroup(chat, canPost, { immediate: true });
                    logger.info(`[CHANNEL] Bot admin em: ${chat.title} (${chat.id}) post=${canPost ? 'sim' : 'não'}`);
                    for (const adminId of CONFIG.ID_DONO) {
                        try {
                            await bot.telegram.sendMessage(
                                adminId,
                                `📡 <b>Bot em canal</b>\n\n` +
                                `Nome: <b>${chat.title || 'Canal'}</b>\n` +
                                `ID: <code>${chat.id}</code>\n` +
                                `${chat.username ? `Link: @${chat.username}\n` : ''}` +
                                `Publicar: ${canPost ? '✅ Sim' : '❌ Sem permissão'}\n\n` +
                                `<i>Divulgação automática inclui este canal (produtos rotativos).</i>`,
                                { parse_mode: 'HTML' }
                            );
                        } catch { /* ignore */ }
                    }
                } else if (status === 'left' || status === 'kicked') {
                    try { dbRaw().prepare(`UPDATE telegram_groups SET active=0, updated_at=datetime('now') WHERE chat_id=?`).run(String(chat.id)); } catch { }
                    logger.info(`[CHANNEL] Bot removido de: ${chat.title} (${chat.id})`);
                }
                return;
            }

            if (status === 'member' || status === 'administrator') {
                const isAdmin = status === 'administrator' ? 1 : 0;
                upsertGroup(chat, isAdmin, { immediate: true });
                logger.info(`[GROUP] Bot ${status === 'administrator' ? 'promovido a admin' : 'membro'} em: ${chat.title} (${chat.id}) — divulgação OK sem ler mensagens`);
                for (const adminId of CONFIG.ID_DONO) {
                    try {
                        await bot.telegram.sendMessage(
                            adminId,
                            `🌐 <b>Bot em grupo</b>\n\n` +
                            `Nome: <b>${chat.title || 'Grupo'}</b>\n` +
                            `ID: <code>${chat.id}</code>\n` +
                            `Papel: ${status === 'administrator' ? '👑 Admin' : '👤 Membro (sem admin)'}\n\n` +
                            `<i>Divulgação automática não precisa de “acesso às mensagens” — só de poder enviar.</i>`,
                            { parse_mode: 'HTML' }
                        );
                    } catch { /* ignore */ }
                }
            } else if (status === 'left' || status === 'kicked') {
                try { dbRaw().prepare(`UPDATE telegram_groups SET active=0, updated_at=datetime('now') WHERE chat_id=?`).run(String(chat.id)); } catch { }
                logger.info(`[GROUP] Bot removido de: ${chat.title} (${chat.id})`);
            }
        } catch (e) { logger.warn('[GROUP] my_chat_member error: ' + e.message); }
    });

    bot.on('channel_post', async (ctx) => {
        try {
            const chat = ctx.chat;
            const post = ctx.channelPost;
            if (!chat || chat.type !== 'channel' || !post) return;
            const me = bot.botInfo || (await bot.telegram.getMe());
            let isAdmin = 1;
            try {
                const member = await bot.telegram.getChatMember(chat.id, me.id);
                isAdmin = ['administrator', 'creator'].includes(member.status) &&
                    member.can_post_messages !== false ? 1 : 0;
            } catch { /* mantém último estado */ }
            upsertGroup(chat, isAdmin);

            if (post.message_id && post.from?.id === me.id) {
                try {
                    const { getDeliverySlotStore } = require('../../services/DeliverySlotStore');
                    const preview = (post.text || post.caption || '').slice(0, 400);
                    await getDeliverySlotStore(dbRaw).save(String(chat.id), {
                        messageId: post.message_id,
                        menuType: 'channel_promo',
                        messageType: post.photo || post.video ? 'photo' : 'text',
                        text: preview,
                    });
                } catch (e) {
                    logger.debug('[CHANNEL] slot from channel_post:', e.message);
                }
            }
        } catch (e) {
            logger.warn('[CHANNEL] channel_post:', e.message);
        }
    });

    bot.on('chat_member', async (ctx) => {
        try {
            const update = ctx.chatMember;
            if (!update) return;
            const { chat } = update;

            if (chat.type === 'channel') {
                const refGuard = require('../referenceChannelGuard');
                if (await refGuard.handleRefChannelChatMember(ctx)) return;
                return;
            }

            const { new_chat_member, old_chat_member } = update;
            if (chat.type !== 'group' && chat.type !== 'supergroup') return;
            const u = new_chat_member.user;
            const status = new_chat_member.status;

            try {
                const me = bot.botInfo || (await bot.telegram.getMe());
                const member = await bot.telegram.getChatMember(chat.id, me.id);
                const isAdminBot = ['administrator', 'creator'].includes(member.status) ? 1 : 0;
                upsertGroup(chat, isAdminBot, { immediate: true });
            } catch {
                upsertGroup(chat, 0, { immediate: true });
            }

            if (u.is_bot) return;

            if (status === 'member' || status === 'administrator' || status === 'creator') {
                const role = status === 'creator' ? 'creator' : status === 'administrator' ? 'admin' : 'member';
                upsertGroupMember(chat.id, u, role, { immediate: true });

                const vipId = getVipGroupId();
                if (vipId && chat.id === vipId && (old_chat_member?.status === 'left' || old_chat_member?.status === 'kicked')) {
                    const nome = u.first_name || 'amigo(a)';
                    const prods = await loadProducts();
                    const destaque = prods[Math.floor(Math.random() * Math.min(prods.length, 5))];
                    let txt = `👋 <b>Bem-vindo(a), ${nome}!</b>\n\nObrigado por fazer parte da comunidade Hanork.\n\n• Ofertas e novidades\n• Catálogo e suporte no bot\n• Inscreva-se também no canal de referências`;
                    if (destaque) txt += `\n\n🔥 <b>Destaque hoje:</b> ${destaque.name} por R$ ${Number(destaque.price).toFixed(2)}`;
                    const me = bot.botInfo || await bot.telegram.getMe();
                    await bot.telegram.sendMessage(chat.id, txt, {
                        parse_mode: 'HTML',
                        reply_markup: Markup.inlineKeyboard([[{ text: '🛍️ Ver Loja', url: `https://t.me/${me.username}` }]]).reply_markup,
                    });
                }
            } else if (status === 'left' || status === 'kicked') {
                try { dbRaw().prepare(`UPDATE group_members SET active=0, last_seen_at=datetime('now') WHERE group_chat_id=? AND telegram_id=?`).run(String(chat.id), String(u.id)); } catch { }
            }
            return;
        } catch (e) { logger.warn('[GROUP] chat_member error: ' + e.message); }
    });

    bot.on('new_chat_members', async (ctx) => {
        const newMembers = ctx.message.new_chat_members;
        const chat = ctx.chat;

        for (const member of newMembers) {
            if (member.is_bot && member.id === ctx.botInfo.id) {
                try {
                    upsertGroup(chat, 0, { immediate: true });
                    logger.info(`[GRUPO] Bot entrou via new_chat_members: ${chat.title}`);
                } catch (e) {
                    logger.error('Erro ao registrar grupo:', e.message);
                }
            } else if (!member.is_bot) {
                try {
                    upsertGroupMember(chat.id, member, 'member', { immediate: true });
                    logger.info(`[GRUPO] novo membro registrado chat=${chat.id} user=${member.id}`);
                } catch { /* ignore */ }
            }
        }
        return;
    });

    bot.on('left_chat_member', async (ctx) => {
        try {
            const chat = ctx.chat;
            const member = ctx.message.left_chat_member;
            if (!chat || !member || member.is_bot) return;

            try {
                dbRaw()
                    .prepare(
                        `UPDATE group_members SET active=0, last_seen_at=datetime('now')
                         WHERE group_chat_id=? AND telegram_id=?`
                    )
                    .run(String(chat.id), String(member.id));
            } catch { /* ignore */ }

            logger.info(`[GRUPO] membro saiu chat=${chat.id} user=${member.id}`);
        } catch (e) {
            logger.warn('[GROUP] left_chat_member error: ' + e.message);
        }
        return;
    });
}

module.exports = { createGroupHelpers, registerGroupEvents };
