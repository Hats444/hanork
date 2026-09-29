'use strict';

/**
 * Painéis admin: alcance da divulgação (PV, grupos, canais).
 */
const { Markup } = require('telegraf');

const PAGE_SIZE = 12;

function typeLabel(type) {
    if (type === 'channel') return '📡';
    if (type === 'supergroup') return '👥';
    return '👥';
}

/**
 * Hub — explica onde o bot pode divulgar e atalhos.
 */
function buildDestinationsHubMessage(stats = {}) {
    const s = stats;
    return (
        `<b>📣 Alcance da divulgação</b>\n\n` +
        `<b>O que o Hanork cobre hoje</b>\n` +
        `├─ 👤 <b>PV (usuários)</b> — quem deu /start; mensagem editada no privado\n` +
        `├─ 👥 <b>Grupos (bot)</b> — ${s.targets ?? 0} alvo(s) · ${s.total ?? 0} ativo(s)\n` +
        `├─ 📡 <b>Grupos (ponte MTProto)</b> — ${s.bridgePromo ?? 0} · divulgação pela sua conta\n` +
        `└─ 📡 <b>Canais</b> — ${s.channelTargets ?? 0} alvo(s) · ${s.channels ?? 0} cadastrado(s)\n\n` +
        `<b>Outras formas no Telegram (fora do bot)</b>\n` +
        `• <b>Telegram Ads</b> — anúncios oficiais (ads.telegram.org)\n` +
        `• <b>Parcerias</b> — post em canais de terceiros manualmente\n` +
        `• <b>Bot inline</b> — outro bot encaminha (integração custom)\n\n` +
        `<i>O Bot API não envia em “feed geral” nem em chats sem o bot estar no destino.</i>\n\n` +
        `🤖 Auto-divulgação: <b>PV + grupos + canais + ponte MTProto</b> (produtos em rotação)`
    );
}

function destinationsHubKeyboard() {
    return Markup.inlineKeyboard([
        [
            { text: '👤 Usuários', callback_data: 'a_users' },
            { text: '👥 Grupos', callback_data: 'a_grupos' },
            { text: '📡 Canais', callback_data: 'a_canais' },
        ],
        [
            { text: '📱 Grupos (meu número)', callback_data: 'a_bridge_grupos' },
            { text: '📢 Broadcast', callback_data: 'a_bcast' },
        ],
        [{ text: '🔄 Sync destinos', callback_data: 'grp_sync' }],
        [{ text: '⚙️ Config grupos', callback_data: 'grp_config' }],
        [{ text: '🔙 Admin', callback_data: 'a_menu' }],
    ]);
}

function formatBridgeAccountStatus(bridgeInfo = {}, stats = {}, botTag = '') {
    const tag = String(botTag || process.env.BOT_USERNAME || 'hanork_bot').replace(/^@/, '');
    const botLine =
        `🤖 <b>Bot</b> @${tag} — ${stats.targets ?? 0} na divulgação · ${stats.admin ?? 0} admin`;
    let phoneLine;
    if (!bridgeInfo.available) {
        phoneLine = '📱 <b>Sua conta</b> — ponte MTProto indisponível';
    } else if (!bridgeInfo.configured || !bridgeInfo.connected) {
        phoneLine =
            '📱 <b>Sua conta</b> — 🔴 desconectada · <code>/conectar</code> (QR)';
    } else {
        const who = [];
        if (bridgeInfo.phoneMasked) who.push(bridgeInfo.phoneMasked);
        else if (bridgeInfo.phone) who.push(`+${bridgeInfo.phone}`);
        if (bridgeInfo.username) who.push(`@${bridgeInfo.username}`);
        else if (bridgeInfo.displayName) who.push(bridgeInfo.displayName);
        const label = who.length ? who.join(' · ') : 'Conta conectada';
        const n = stats.bridgeTargets ?? stats.bridgePromo ?? 0;
        phoneLine =
            `📱 <b>Sua conta</b> ${label}\n` +
            `   🟢 conectada · <b>${n}</b> grupo(s) só via número`;
    }
    return `${botLine}\n${phoneLine}`;
}

/**
 * Lista paginada de grupos (estilo a_users).
 */
function buildGroupsListMessage(db, groupService, pageIndex = 0, { bridgeInfo = null, botTag = '' } = {}) {
    groupService?.repairBridgePromoGroups?.();
    const limit = PAGE_SIZE;
    const offset = Math.max(0, pageIndex) * limit;
    const whereClause = `active=1 AND (type IN ('group','supergroup') OR COALESCE(promo_via_bridge,0)=1)`;
    const total = db.prepare(`SELECT COUNT(*) as c FROM telegram_groups WHERE ${whereClause}`).get()?.c || 0;
    const rows = db
        .prepare(
            `SELECT chat_id, title, type, username, bot_is_admin, broadcast_enabled,
                    COALESCE(promo_via_bridge,0) as promo_via_bridge, updated_at
             FROM telegram_groups
             WHERE ${whereClause}
             ORDER BY promo_via_bridge DESC, updated_at DESC
             LIMIT ? OFFSET ?`
        )
        .all(limit, offset);
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const pageNum = pageIndex + 1;
    const stats = groupService?.getStats?.() || {};

    let txt =
        `<b>👥 Grupos</b> — ${pageNum}/${totalPages} (total: ${total})\n\n` +
        `${formatBridgeAccountStatus(bridgeInfo || {}, stats, botTag)}\n\n`;

    if (!rows.length) {
        txt += `<i>Nenhum grupo. Adicione o bot ou use</i> <code>/entrar @grupo</code>`;
    } else {
        for (const g of rows) {
            const on = g.broadcast_enabled !== 0;
            const admin = g.bot_is_admin ? '👑' : g.promo_via_bridge ? '📱' : '👤';
            const via = g.promo_via_bridge ? '📱 número' : '🤖 bot';
            const mc =
                db.prepare('SELECT COUNT(*) as c FROM group_members WHERE group_chat_id=? AND active=1')
                    .get(String(g.chat_id))?.c || 0;
            txt += `${admin} ${on ? '📢' : '⏸️'} <b>${String(g.title || 'Grupo').slice(0, 28)}</b> · ${via}\n`;
            txt += `   <code>${g.chat_id}</code>`;
            if (g.username) txt += ` · @${g.username}`;
            if (g.promo_via_bridge) {
                txt += `\n   <i>Divulgação pelo seu número (bot fora)</i>`;
            } else {
                txt += `\n   👤 ${mc} membros rastreados`;
            }
            txt += `\n\n`;
        }
    }
    return { txt, totalPages, pageIndex, rows };
}

function groupsListKeyboard(pageIndex, totalPages, rows, { bridgeConnected = false } = {}) {
    const nav = [];
    if (pageIndex > 0) nav.push({ text: '◀️', callback_data: `a_grupos_p_${pageIndex - 1}` });
    if (pageIndex + 1 < totalPages) nav.push({ text: '▶️', callback_data: `a_grupos_p_${pageIndex + 1}` });
    const kb = [];
    if (nav.length) kb.push(nav);
    kb.push([
        { text: '📱 Grupos do meu número', callback_data: 'a_bridge_grupos' },
        { text: '🔗 /entrar', callback_data: 'a_entrar_help' },
    ]);
    if (bridgeConnected) {
        kb.push([{ text: '📡 Divulgar só ponte', callback_data: 'bcast_bridge_now' }]);
    }
    const toggles = rows.slice(0, 4).map((g) => ({
        text: `${g.broadcast_enabled !== 0 ? '📢' : '⏸️'} ${String(g.title).slice(0, 12)}`,
        callback_data: `grp_bcast_toggle_${g.chat_id}`,
    }));
    if (toggles.length >= 2) kb.push(toggles.slice(0, 2));
    if (toggles.length > 2) kb.push(toggles.slice(2, 4));
    kb.push(
        [{ text: '📣 Alcance', callback_data: 'a_destinos' }, { text: '⚙️ Config', callback_data: 'grp_config' }],
        [{ text: '🔄 Sync', callback_data: 'grp_sync' }, { text: '🔙 Admin', callback_data: 'a_menu' }]
    );
    return Markup.inlineKeyboard(kb);
}

function buildBridgeGroupsListMessage(db, groupService, pageIndex = 0, { bridgeInfo = null, botTag = '' } = {}) {
    groupService?.repairBridgePromoGroups?.();
    const limit = PAGE_SIZE;
    const offset = Math.max(0, pageIndex) * limit;
    const total = groupService?.countBridgePromoGroups?.() ?? 0;
    const rows = groupService?.listBridgePromoGroups?.(limit, offset) || [];
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const pageNum = pageIndex + 1;
    const stats = groupService?.getStats?.() || {};

    let txt =
        `<b>📱 Grupos — sua conta MTProto</b> — ${pageNum}/${totalPages} (total: ${total})\n\n` +
        `${formatBridgeAccountStatus(bridgeInfo || {}, stats, botTag)}\n\n`;

    try {
        const { getBridgePoolService } = require('../../services/BridgePoolService');
        const qs = getBridgePoolService().getQueueStats();
        txt +=
            `🎯 <b>Pool automático:</b> ${qs.active}/${qs.max} ativos · ` +
            `${qs.pending} na fila · mín. ${getBridgePoolService().minMembers()} membros\n\n`;
    } catch {
        /* ignore */
    }

    txt +=
        `<i>Envie links de grupo no PV ou em grupos ponte — entrada automática.</i>\n\n`;

    if (!bridgeInfo?.connected) {
        txt += `⚠️ Conecte com <code>/conectar</code> para divulgar.\n\n`;
    }

    if (!rows.length) {
        txt +=
            `<i>Nenhum grupo ainda.</i>\n\n` +
            `Envie um link no PV ou use <code>/entrar @grupo</code>\n\n` +
            `Requisitos: ≥${getBridgePoolService().minMembers()} membros · conta pode enviar mensagens · máx. ${getBridgePoolService().maxGroups()} grupos.`;
    } else {
        for (const g of rows) {
            const on = g.broadcast_enabled !== 0;
            txt += `📱 ${on ? '📢' : '⏸️'} <b>${String(g.title || 'Grupo').slice(0, 30)}</b>\n`;
            txt += `   <code>${g.chat_id}</code>`;
            if (g.username) txt += ` · @${g.username}`;
            txt += `\n\n`;
        }
    }
    return { txt, totalPages, pageIndex, rows, total };
}

function bridgeGroupsListKeyboard(pageIndex, totalPages, rows, { bridgeConnected = false } = {}) {
    const nav = [];
    if (pageIndex > 0) nav.push({ text: '◀️', callback_data: `a_bridge_grupos_p_${pageIndex - 1}` });
    if (pageIndex + 1 < totalPages) nav.push({ text: '▶️', callback_data: `a_bridge_grupos_p_${pageIndex + 1}` });
    const kb = [];
    if (nav.length) kb.push(nav);
    if (bridgeConnected) {
        kb.push([{ text: '📡 Divulgar agora (só ponte)', callback_data: 'bcast_bridge_now' }]);
    }
    kb.push([{ text: '🔗 /entrar em grupo', callback_data: 'a_entrar_help' }]);
    const toggles = rows.slice(0, 4).map((g) => ({
        text: `${g.broadcast_enabled !== 0 ? '📢' : '⏸️'} ${String(g.title).slice(0, 12)}`,
        callback_data: `grp_bcast_toggle_${g.chat_id}_bridge`,
    }));
    if (toggles.length >= 2) kb.push(toggles.slice(0, 2));
    if (toggles.length > 2) kb.push(toggles.slice(2, 4));
    kb.push(
        [{ text: '👥 Todos os grupos', callback_data: 'a_grupos' }],
        [{ text: '📣 Alcance', callback_data: 'a_destinos' }, { text: '🔙 Admin', callback_data: 'a_menu' }]
    );
    return Markup.inlineKeyboard(kb);
}

/**
 * Lista paginada de canais.
 */
function buildChannelsListMessage(db, groupService, pageIndex = 0) {
    const limit = PAGE_SIZE;
    const offset = Math.max(0, pageIndex) * limit;
    const total =
        db.prepare(`SELECT COUNT(*) as c FROM telegram_groups WHERE active=1 AND type='channel'`).get()?.c || 0;
    const rows = db
        .prepare(
            `SELECT chat_id, title, type, username, bot_is_admin, broadcast_enabled, updated_at
             FROM telegram_groups WHERE active=1 AND type='channel'
             ORDER BY updated_at DESC LIMIT ? OFFSET ?`
        )
        .all(limit, offset);
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const pageNum = pageIndex + 1;
    const stats = groupService?.getStats?.() || {};

    let txt =
        `<b>📡 Canais</b> — ${pageNum}/${totalPages} (total: ${total})\n` +
        `${stats.channelTargets ?? 0} na divulgação · ${stats.channelsAdmin ?? 0} podem publicar\n\n`;

    if (!rows.length) {
        txt +=
            `<i>Nenhum canal. Adicione o bot como admin com “Publicar mensagens” ou</i>\n` +
            `<code>/canal add -100xxxxxxxx</code>`;
    } else {
        for (const c of rows) {
            const on = c.broadcast_enabled !== 0;
            const admin = c.bot_is_admin ? '👑' : '⚠️';
            const refOnly = require('../../config/salesReferenceChannel').isSalesRefChannel(c.chat_id);
            txt += `${admin} ${refOnly ? '📋' : on ? '📢' : '⏸️'} <b>${String(c.title || 'Canal').slice(0, 30)}</b>\n`;
            txt += `   <code>${c.chat_id}</code>`;
            if (c.username) txt += ` · @${c.username}`;
            if (refOnly) txt += `\n   <i>Só referências de venda (sem divulgação)</i>`;
            txt += `\n\n`;
        }
    }
    return { txt, totalPages, pageIndex, rows };
}

function channelsListKeyboard(pageIndex, totalPages, rows) {
    const nav = [];
    if (pageIndex > 0) nav.push({ text: '◀️', callback_data: `a_canais_p_${pageIndex - 1}` });
    if (pageIndex + 1 < totalPages) nav.push({ text: '▶️', callback_data: `a_canais_p_${pageIndex + 1}` });
    const kb = [];
    if (nav.length) kb.push(nav);
    const toggles = rows.slice(0, 4).map((c) => ({
        text: `${c.broadcast_enabled !== 0 ? '📢' : '⏸️'} ${String(c.title).slice(0, 12)}`,
        callback_data: `grp_bcast_toggle_${c.chat_id}`,
    }));
    if (toggles.length >= 2) kb.push(toggles.slice(0, 2));
    if (toggles.length > 2) kb.push(toggles.slice(2, 4));
    kb.push(
        [{ text: '📣 Alcance', callback_data: 'a_destinos' }, { text: '🔄 Sync', callback_data: 'grp_sync' }],
        [{ text: '🔙 Admin', callback_data: 'a_menu' }]
    );
    return Markup.inlineKeyboard(kb);
}

module.exports = {
    PAGE_SIZE,
    buildDestinationsHubMessage,
    destinationsHubKeyboard,
    formatBridgeAccountStatus,
    buildGroupsListMessage,
    groupsListKeyboard,
    buildBridgeGroupsListMessage,
    bridgeGroupsListKeyboard,
    buildChannelsListMessage,
    channelsListKeyboard,
    typeLabel,
};
