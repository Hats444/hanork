'use strict';

const { denyCbSilent } = require('../../utils/silencedAccess');

const { Markup } = require('telegraf');
const { respond, isGroupChat } = require('../respond');

/**
 * Comandos e painel de configuração de grupos (VIP, suporte, divulgação).
 */
function registerGroupHandlers(bot, deps) {
    const {
        isAdmin,
        Msg,
        ADMIN_HTML,
        dbRaw,
        groupSettings,
        groupService,
        editAdminPanel,
        renderGroupsPanel,
    } = deps;

    function isGroupCtx(ctx) {
        return isGroupChat(ctx);
    }

    async function gReply(ctx, text, kb = null) {
        return respond(ctx, text, kb);
    }

    async function showGroupConfig(ctx, useEdit = true) {
        const db = dbRaw();
        const stats = groupService.getStats();
        const txt =
            `${ADMIN_HTML.header('Configuração de Grupos')}\n\n` +
            `${groupSettings.formatConfigSummary(db)}\n\n` +
            `📊 Ativos: <b>${stats.total}</b> | Admin: <b>${stats.admin}</b>\n` +
            `📢 Alvos divulgação: <b>${stats.targets}</b>\n\n` +
            `<i>Dentro de um grupo:</i>\n` +
            `<code>/grupo vip</code> · <code>/grupo suporte</code> · <code>/grupo info</code>`;

        const kb = Markup.inlineKeyboard([
            [
                {
                    text: groupSettings.isCooldownEnabled() ? '⏱️ Cooldown: ON' : '⏱️ Cooldown: OFF',
                    callback_data: 'grp_cooldown_toggle',
                },
                {
                    text: groupSettings.isRequireAdmin() ? '🔐 Só admin' : '👥 Todos ativos',
                    callback_data: 'grp_mode_toggle',
                },
            ],
            [{ text: '🔄 Sincronizar grupos', callback_data: 'grp_sync' }],
            [{ text: '📣 Alcance', callback_data: 'a_destinos' }, { text: '👥 Grupos', callback_data: 'a_grupos' }],
            [{ text: '📡 Canais', callback_data: 'a_canais' }, { text: '🔙 Admin', callback_data: 'a_menu' }],
        ]);

        if (useEdit && ctx.callbackQuery) {
            await Msg.edit(ctx, txt, kb);
        } else if (typeof editAdminPanel === 'function') {
            await editAdminPanel(ctx, txt, kb);
        } else {
            await Msg.reply(ctx, txt, kb);
        }
    }

    bot.command('grupo', async (ctx) => {
        if (!isAdmin(ctx.from.id)) {
            return gReply(ctx, '⛔ Apenas administradores.');
        }

        const args = (ctx.message.text || '').trim().split(/\s+/).slice(1);
        const sub = (args[0] || 'ajuda').toLowerCase();
        const chatId = ctx.chat?.id;

        if (sub === 'ajuda' || sub === 'help') {
            const inGroup = isGroupCtx(ctx);
            return gReply(ctx,
                `${ADMIN_HTML.header('Comando /grupo')}\n\n` +
                    (inGroup
                        ? `📍 Grupo atual: <b>${ctx.chat.title || '—'}</b>\n<code>${chatId}</code>\n\n`
                        : '') +
                    `<b>No grupo:</b>\n` +
                    `• <code>/grupo vip</code> — boas-vindas neste chat (comunidade legada)\n` +
                    `• <code>/grupo suporte</code> — grupo de suporte\n` +
                    `• <code>/grupo info</code> — status\n` +
                    `• <code>/grupo ativar</code> / <code>desativar</code> — divulgação\n\n` +
                    `<b>Geral:</b>\n` +
                    `• <code>/grupo config</code> — painel\n` +
                    `• <code>/grupo sync</code> — atualiza permissões\n` +
                    `• <code>/grupo cooldown off|on</code>\n` +
                    `• <code>/grupo todos</code> / <code>admin</code> — modo divulgação`,
                { parse_mode: 'HTML' }
            );
        }

        if (sub === 'config') {
            return showGroupConfig(ctx, false);
        }

        if (sub === 'sync') {
            await gReply(ctx, '🔄 Sincronizando grupos...');
            const r = await groupService.syncAllGroups();
            return gReply(ctx,
                `✅ Sync: <b>${r.ok}</b> ok, <b>${r.failed}</b> inativos, <b>${r.withAdmin}</b> bot admin (de ${r.total})`,
                { parse_mode: 'HTML' }
            );
        }

        if (sub === 'cooldown') {
            const mode = (args[1] || '').toLowerCase();
            if (mode === 'off' || mode === '0') groupSettings.setCooldownMinutes(0);
            else if (mode === 'on') groupSettings.setCooldownMinutes(30);
            else groupSettings.toggleCooldown();
            const min = groupSettings.getCooldownMinutes();
            return gReply(ctx,
                min > 0
                    ? `⏱️ Cooldown: <b>${min} min</b> por grupo.`
                    : '🔴 Cooldown <b>desligado</b>.',
                { parse_mode: 'HTML' }
            );
        }

        if (sub === 'todos' || sub === 'all') {
            groupSettings.setRequireAdmin(false);
            return gReply(ctx, '👥 Divulgação em <b>todos os grupos ativos</b>.');
        }

        if (sub === 'admin') {
            groupSettings.setRequireAdmin(true);
            return gReply(ctx, '🔐 Divulgação só onde o bot é <b>administrador</b>.');
        }

        if (!isGroupCtx(ctx)) {
            return gReply(ctx, '⚠️ Para vip/suporte/ativar/info, rode o comando <b>no grupo</b>.', {
                parse_mode: 'HTML',
            });
        }

        try {
            const st = await groupService.refreshBotStatusInChat(chatId);
            groupService.upsertGroup(ctx.chat, st.isAdmin ? 1 : 0);
        } catch {
            groupService.upsertGroup(ctx.chat, 0);
        }

        if (sub === 'vip') {
            groupSettings.setVipGroupId(chatId);
            return gReply(ctx,
                `⭐ VIP: <b>${ctx.chat.title}</b>\n<code>${chatId}</code>`
            );
        }

        if (sub === 'suporte' || sub === 'support') {
            groupSettings.setSupportGroupId(chatId);
            return gReply(ctx,
                `🎫 Suporte (tickets): <b>${ctx.chat.title}</b>\n<code>${chatId}</code>\n\n` +
                    `<i>Canal de referências no menu: <code>SALES_REF_CHANNEL_LINK</code> no .env\n` +
                    `Contato pessoal: <code>CONTATO_ESPECIALISTA</code> no .env</i>`
            );
        }

        if (sub === 'limpar') {
            const alvo = (args[1] || '').toLowerCase();
            if (alvo === 'vip') groupSettings.clearVipGroupId();
            else if (alvo === 'suporte' || alvo === 'support') groupSettings.clearSupportGroupId();
            else {
                return gReply(ctx, 'Use: <code>/grupo limpar vip</code> ou <code>suporte</code>');
            }
            return gReply(ctx, '✅ Removido.');
        }

        if (sub === 'ativar' || sub === 'on') {
            groupService.setBroadcastEnabled(chatId, true);
            return gReply(ctx, '✅ Divulgação ativa neste grupo.');
        }

        if (sub === 'desativar' || sub === 'off') {
            groupService.setBroadcastEnabled(chatId, false);
            return gReply(ctx, '⏸️ Divulgação pausada neste grupo.');
        }

        if (sub === 'info') {
            const db = dbRaw();
            const row = db.prepare('SELECT * FROM telegram_groups WHERE chat_id=?').get(String(chatId));
            const vip = groupSettings.getVipGroupId();
            const sup = groupSettings.getSupportGroupId();
            const flags = [];
            if (vip === chatId) flags.push('⭐ VIP');
            if (sup === chatId) flags.push('🎫 Suporte');
            flags.push(row?.broadcast_enabled === 0 ? '⏸️ Divulgação OFF' : '📢 Divulgação ON');
            return gReply(ctx,
                `${ADMIN_HTML.header(ctx.chat.title || 'Grupo')}\n\n` +
                    `ID: <code>${chatId}</code>\n` +
                    `Bot admin: ${row?.bot_is_admin ? '✅' : '⚠️'}\n` +
                    `${flags.join(' · ')}`,
                { parse_mode: 'HTML' }
            );
        }

        return gReply(ctx, 'Use <code>/grupo ajuda</code>.');
    });

    bot.action('grp_config', async (ctx) => {
        if (!isAdmin(ctx.from.id)) await denyCbSilent('admin_callback', ctx); return;
        await ctx.answerCbQuery();
        await showGroupConfig(ctx, true);
    });

    bot.action('grp_cooldown_toggle', async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const on = groupSettings.toggleCooldown();
        await ctx.answerCbQuery(on ? 'Cooldown 30 min' : 'Cooldown OFF');
        await showGroupConfig(ctx, true);
    });

    bot.action('grp_mode_toggle', async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const adminOnly = groupSettings.toggleRequireAdmin();
        await ctx.answerCbQuery(adminOnly ? 'Só admin' : 'Todos ativos');
        await showGroupConfig(ctx, true);
    });

    bot.action('grp_sync', async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery('🔄 Sincronizando...');
        const r = await groupService.syncAllGroups();
        await Msg.edit(
            ctx,
            `${ADMIN_HTML.header('Sync concluído')}\n\n✅ ${r.ok} ok · ❌ ${r.failed} off · 👑 ${r.withAdmin} admin · 📋 ${r.total} total`,
            Markup.inlineKeyboard([[{ text: '🔙 Config', callback_data: 'grp_config' }]])
        );
    });

    bot.action(/^grp_bcast_toggle_(.+?)(?:_bridge)?$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const chatId = ctx.match[1];
        const bridgeView = String(ctx.callbackQuery?.data || '').endsWith('_bridge');
        const on = groupService.toggleBroadcastEnabled(chatId);
        await ctx.answerCbQuery(on ? '📢 ON' : '⏸️ OFF');
        const row = groupService.getGroupRow?.(chatId) || dbRaw().prepare('SELECT type, promo_via_bridge FROM telegram_groups WHERE chat_id=?').get(String(chatId));
        if (bridgeView && typeof deps.showBridgeGroupsList === 'function') {
            await deps.showBridgeGroupsList(ctx, 0);
        } else if (row?.type === 'channel' && typeof deps.showChannelsList === 'function') {
            await deps.showChannelsList(ctx, 0);
        } else if (typeof deps.showGroupsList === 'function') {
            await deps.showGroupsList(ctx, 0);
        }
    });

    bot.command('canal', async (ctx) => {
        if (!isAdmin(ctx.from.id)) {
            return gReply(ctx, '⛔ Apenas administradores.');
        }

        const args = (ctx.message.text || '').trim().split(/\s+/).slice(1);
        const sub = (args[0] || 'ajuda').toLowerCase();

        if (sub === 'ajuda' || sub === 'help') {
            return gReply(
                ctx,
                `${ADMIN_HTML.header('Comando /canal')}\n\n` +
                    `<b>Como cadastrar</b>\n` +
                    `1. Adicione o bot como <b>administrador</b> do canal\n` +
                    `2. Ative <b>Publicar mensagens</b> para o bot\n` +
                    `3. O canal entra na lista automaticamente\n\n` +
                    `<b>Comandos</b>\n` +
                    `• <code>/canal lista</code> — canais ativos\n` +
                    `• <code>/canal add -100123456789</code> — cadastro manual\n` +
                    `• <code>/canal sync</code> — atualiza permissões\n` +
                    `• <code>/canal info</code> — no PV com ID do canal\n\n` +
                    `<i>Divulgação automática envia para usuários, grupos e canais.</i>`,
                { parse_mode: 'HTML' }
            );
        }

        if (sub === 'lista' || sub === 'list') {
            const channels = groupService.listActiveChannels(20);
            if (!channels.length) {
                return gReply(ctx, '📡 Nenhum canal cadastrado.\n\nAdicione o bot como admin do canal ou use <code>/canal add ID</code>.');
            }
            let txt = `${ADMIN_HTML.header(`Canais (${channels.length})`)}\n\n`;
            for (const c of channels) {
                const on = c.broadcast_enabled !== 0;
                const refOnly = require('../../config/salesReferenceChannel').isSalesRefChannel(c.chat_id);
                const flag = refOnly ? '📋' : on ? '📢' : '⏸️';
                txt += `${c.bot_is_admin ? '👑' : '⚠️'} ${flag} <b>${c.title}</b>\n<code>${c.chat_id}</code>`;
                if (refOnly) txt += `\n<i>Referências de venda apenas</i>`;
                txt += `\n\n`;
            }
            return gReply(ctx, txt, { parse_mode: 'HTML' });
        }

        if (sub === 'sync') {
            await gReply(ctx, '🔄 Sincronizando canais e grupos...');
            const r = await groupService.syncAllGroups();
            const st = groupService.getStats();
            return gReply(
                ctx,
                `✅ Sync: ${r.ok}/${r.total} · 👑 ${r.withAdmin} admin\n\n` +
                    `📡 Canais ativos: <b>${st.channels}</b> · alvos divulgação: <b>${st.channelTargets}</b>`,
                { parse_mode: 'HTML' }
            );
        }

        if (sub === 'add' && args[1]) {
            try {
                const chat = await groupService.registerChannelById(args[1]);
                return gReply(
                    ctx,
                    `✅ Canal cadastrado!\n\n<b>${chat.title}</b>\n<code>${chat.id}</code>` +
                        (chat.username ? `\n@${chat.username}` : ''),
                    { parse_mode: 'HTML' }
                );
            } catch (e) {
                return gReply(ctx, `❌ ${e.message}`);
            }
        }

        if (sub === 'info' && args[1]) {
            try {
                const chat = await groupService.registerChannelById(args[1]);
                const row = dbRaw().prepare('SELECT * FROM telegram_groups WHERE chat_id=?').get(String(chat.id));
                return gReply(
                    ctx,
                    `${ADMIN_HTML.header(chat.title)}\n\n` +
                        `ID: <code>${chat.id}</code>\n` +
                        `Admin: ${row?.bot_is_admin ? '✅' : '❌'}\n` +
                        `Divulgação: ${row?.broadcast_enabled === 0 ? '⏸️' : '📢'}`,
                    { parse_mode: 'HTML' }
                );
            } catch (e) {
                return gReply(ctx, `❌ ${e.message}`);
            }
        }

        return gReply(ctx, 'Use <code>/canal ajuda</code>.');
    });
}

module.exports = { registerGroupHandlers };
