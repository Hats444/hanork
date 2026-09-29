'use strict';

const { isGroupChat } = require('../groupGuard');

function extractUrl(text) {
    const m = String(text || '').match(/https?:\/\/[^\s<>"']+/i);
    return m ? m[0].replace(/[.,;)]+$/, '') : null;
}

function formatChatType(type) {
    const map = {
        private: 'Privado (PV)',
        group: 'Grupo',
        supergroup: 'Supergrupo',
        channel: 'Canal',
    };
    return map[type] || type || '—';
}

async function resolveInviteLink(telegram, chat) {
    if (!chat?.id) return null;
    if (chat.username) return `https://t.me/${chat.username}`;
    try {
        return await telegram.exportChatInviteLink(chat.id);
    } catch {
        return null;
    }
}

const GroupLinkSync = require('../../services/GroupLinkSyncService');

function registerIdCommands(bot, deps) {
    const { isAdmin, Msg, groupSettings, groupService, syncBusinessLinks, logger } = deps;

    bot.command('id', async (ctx) => {
        const chat = ctx.chat;
        const from = ctx.from;
        if (!chat || !from) return;

        if (isGroupChat(ctx)) {
            const chatId = chat.id;
            const inviteLink = await resolveInviteLink(ctx.telegram, chat);

            let txt =
                `🆔 <b>Identificação do chat</b>\n` +
                `━━━━━━━━━━━━━━━━━━━━\n\n` +
                `📛 <b>Nome:</b> ${chat.title || '—'}\n` +
                `📂 <b>Tipo:</b> ${formatChatType(chat.type)}\n` +
                `🔢 <b>ID:</b> <code>${chatId}</code>\n`;

            if (chat.username) txt += `👤 <b>Username:</b> @${chat.username}\n`;
            if (inviteLink) {
                txt += `\n🔗 <b>Link de convite:</b>\n<code>${inviteLink}</code>\n`;
            } else {
                txt += `\n<i>Link: bot precisa ser admin com permissão de convite, ou use username público.</i>\n`;
            }

            const vip = groupSettings?.getVipGroupId?.();
            const sup = groupSettings?.getSupportGroupId?.();
            const downloadsGuard = require('../downloadsGuard');
            const dl = downloadsGuard.resolveDownloadsGroupId?.();
            const flags = [];
            if (vip === chatId) flags.push('⭐ VIP');
            if (sup === chatId) flags.push('🎫 Suporte (tickets)');
            if (dl === chatId) flags.push('⬇️ Downloads');
            if (flags.length) txt += `\n📌 <b>Função no bot:</b> ${flags.join(' · ')}\n`;

            if (isAdmin(from.id)) {
                txt +=
                    `\n<b>Admin</b>\n` +
                    `• <code>/grupo suporte</code> — ID do grupo para tickets\n` +
                    `• <code>/atualizarlink</code> — salva link (menu + botão de downloads)\n` +
                    `<i>Não altera seu contato pessoal de suporte.</i>`;
            }

            return Msg.reply(ctx, txt, { parse_mode: 'HTML' });
        }

        let txt =
            `🆔 <b>Seus dados</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━\n\n` +
            `🔢 <b>Seu ID:</b> <code>${from.id}</code>\n` +
            `💬 <b>Chat ID:</b> <code>${chat.id}</code>\n`;

        if (from.username) txt += `👤 <b>Username:</b> @${from.username}\n`;
        const fullName = [from.first_name, from.last_name].filter(Boolean).join(' ');
        if (fullName) txt += `📛 <b>Nome:</b> ${fullName}\n`;
        if (from.language_code) txt += `🌐 <b>Idioma:</b> ${from.language_code}\n`;
        if (from.is_premium) txt += `⭐ <b>Telegram Premium:</b> Sim\n`;

        const botUser = deps.getBotUsername?.() || process.env.BOT_USERNAME || '';
        if (botUser) {
            txt += `\n🤖 <b>Link direto para você:</b>\n<code>https://t.me/${botUser}?start=ref_check</code>\n`;
        }

        if (isAdmin(from.id) && groupSettings) {
            txt +=
                `\n<b>Links configurados</b>\n` +
                `📞 Contato suporte: <code>${groupSettings.getContactUrl()}</code>\n` +
                `👥 Link grupo: <code>${groupSettings.getVipGroupUrl()}</code>\n` +
                `🎫 ID grupo tickets: <code>${groupSettings.getSupportGroupId() || '—'}</code>\n` +
                `\n<i><code>/atualizarlink</code> só muda o link do grupo, não o seu contato.</i>`;
        }

        return Msg.reply(ctx, txt, { parse_mode: 'HTML' });
    });

    bot.command('atualizarlink', async (ctx) => {
        if (!isAdmin(ctx.from.id)) {
            return Msg.reply(ctx, '⛔ Apenas administradores.');
        }

        const text = ctx.message?.text || '';
        const args = text.trim().split(/\s+/).slice(1);
        let url = args.find((a) => /^https?:\/\//i.test(a)) || extractUrl(text);
        let groupTitle = null;
        let groupId = null;

        if (isGroupChat(ctx)) {
            groupId = ctx.chat.id;
            groupTitle = ctx.chat.title || String(groupId);

            try {
                const st = await groupService.refreshBotStatusInChat(groupId);
                groupService.upsertGroup(ctx.chat, st.isAdmin ? 1 : 0);
            } catch {
                groupService?.upsertGroup?.(ctx.chat, 0);
            }

            if (!url) {
                url = await resolveInviteLink(ctx.telegram, ctx.chat);
            }
        }

        if (!url) {
            return Msg.reply(
                ctx,
                `🔗 <b>Atualizar link do grupo</b>\n\n` +
                    `Atualiza <b>automaticamente</b> convites legados em:\n` +
                    `• <code>LINKGP</code> no <code>.env</code>\n` +
                    `• README/docs com links expirados\n\n` +
                    `<i>O menu do bot usa o canal de referências (<code>SALES_REF_CHANNEL_LINK</code>).</i>\n\n` +
                    `<b>No grupo</b> (sem URL): exporta o convite agora.\n\n` +
                    `<b>Com URL:</b>\n` +
                    `<code>/atualizarlink https://t.me/+...</code>\n\n` +
                    `📞 Contato suporte: <code>CONTATO_ESPECIALISTA</code> no .env <i>(não muda)</i>`,
                { parse_mode: 'HTML' }
            );
        }

        const syncResult = GroupLinkSync.syncGroupInviteLink({
            url,
            groupSettings,
            groupId,
            logger,
        });

        if (!syncResult.ok) {
            return Msg.reply(ctx, '❌ Link inválido. Use <code>https://t.me/+...</code> ou rode o comando dentro do grupo.', {
                parse_mode: 'HTML',
            });
        }

        if (typeof syncBusinessLinks === 'function') syncBusinessLinks();

        const report = GroupLinkSync.formatSyncReport(syncResult);
        let reply =
            `✅ <b>Link do grupo atualizado!</b>\n\n` +
            `👥 <code>${syncResult.url}</code>\n\n` +
            `<b>Sincronizado:</b>\n${report}`;

        if (groupId != null) {
            reply +=
                `\n\n📛 Grupo: <b>${groupTitle}</b>\n` +
                `🔢 ID: <code>${groupId}</code>\n` +
                `<i>Use <code>/grupo suporte</code> aqui se for o grupo de tickets.</i>`;
        }

        return Msg.reply(ctx, reply, { parse_mode: 'HTML' });
    });
}

module.exports = { registerIdCommands, resolveInviteLink, extractUrl };
