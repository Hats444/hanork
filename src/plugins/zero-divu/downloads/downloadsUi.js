'use strict';

const { Markup } = require('telegraf');
const { escapeTelegramHtml } = require('../htmlEscape');
const downloadsGuard = require('../downloadsGuard');
const groupGuard = require('../groupGuard');
const { CHANNEL_UI } = require('../../config/salesReferenceChannel');
const downloadsNav = require('./downloadsNav');
const playUi = require('../play/playUi');
const tiktokUi = require('../tiktok/tiktokUi');
const instagramUi = require('../instagram/instagramUi');
const youtubeUi = require('../youtube/youtubeUi');

function getAdminIds() {
    return (process.env.ID_DONO || '')
        .split(',')
        .map((id) => parseInt(id.trim(), 10))
        .filter(Boolean);
}

function viewer(ctx) {
    const f = ctx.from || {};
    const id = f.id;
    const first = String(f.first_name || '').trim();
    const last = String(f.last_name || '').trim();
    const fullName = [first, last].filter(Boolean).join(' ') || 'Visitante';
    const username = f.username ? `@${f.username}` : null;
    const isAdmin = id != null && getAdminIds().includes(id);
    const lang = f.language_code ? String(f.language_code).toUpperCase() : null;
    return { id, fullName, username, isAdmin, lang, first };
}

function formatUserCard(ctx) {
    const v = viewer(ctx);
    const name = escapeTelegramHtml(v.fullName);
    const lines = [`👋 Olá, <b>${name}</b>`];
    if (v.username) lines.push(`🔗 ${escapeTelegramHtml(v.username)}`);
    lines.push(`🆔 <code>${v.id}</code>`);
    if (v.lang) lines.push(`🌐 ${escapeTelegramHtml(v.lang)}`);
    if (v.isAdmin) lines.push(`<i>🔧 Administrador</i>`);
    return lines.join('\n');
}

function formatHubPanel(ctx) {
    const v = viewer(ctx);
    const inPv = !groupGuard.isGroupChat(ctx);
    const st = downloadsGuard.getDailyStatus?.(v.id);
    const limitLine =
        inPv && st
            ? `\n\n📊 <b>${st.remaining}</b> de <b>${st.limit}</b> downloads restantes hoje.`
            : '';
    const pvGuide = !inPv
        ? `\n\n<i>ℹ️ Downloads funcionam no <b>privado</b> com o bot — entre no canal de referências e use <code>/downloads</code>.</i>`
        : '';
    return (
        `<b>⬇️ Central Hanork Downloads</b>\n` +
        `<i>🎧 Música · 📺 YouTube · 🎬 TikTok · 📸 Instagram</i>\n\n` +
        `${formatUserCard(ctx)}\n\n` +
        `Use no <b>privado</b> (após entrar no canal de referências):\n\n` +
        `🎧 <code>/play</code> — busca por nome ou link YouTube <i>(somente áudio)</i>\n` +
        `📺 <code>/youtube</code> — vídeo completo, Shorts ou live\n` +
        `🎬 <code>/tiktok</code> — por @usuário, busca ou link direto\n` +
        `📸 <code>/instagram</code> — posts, reels, stories e destaques\n\n` +
        `<i>Dica: links YouTube no PV baixam vídeo; para música prefira /play.</i>` +
        limitLine +
        pvGuide
    );
}

function formatPlayPanel(ctx) {
    return `${formatUserCard(ctx)}\n\n${playUi.formatHelpPanel()}`;
}

function formatTikTokPanel(ctx) {
    return `${formatUserCard(ctx)}\n\n${tiktokUi.formatHelpPanel()}`;
}

function formatYoutubePanel(ctx) {
    return `${formatUserCard(ctx)}\n\n${youtubeUi.formatHelpPanel()}`;
}

function formatInstagramPanel(ctx) {
    return `${formatUserCard(ctx)}\n\n${instagramUi.formatHelpPanel()}`;
}

function formatInstagramStoriesPanel(ctx) {
    return (
        `<b>📖 Stories</b>\n\n` +
        `${formatUserCard(ctx)}\n\n` +
        `Baixe stories ativos de um perfil:\n\n` +
        `<code>/instagram stories @usuario</code>\n` +
        `<code>/instagram @usuario</code>\n\n` +
        `<i>Stories expirados não aparecem.</i>`
    );
}

function formatInstagramHighlightsPanel(ctx) {
    return (
        `<b>⭐ Destaques</b>\n\n` +
        `${formatUserCard(ctx)}\n\n` +
        `Baixe capas e mídias dos destaques:\n\n` +
        `<code>/instagram highlights @usuario</code>\n\n` +
        `<i>Perfil precisa ser público.</i>`
    );
}

function navRows(ctx) {
    const rows = [];
    if (viewer(ctx).isAdmin) {
        rows.push([Markup.button.callback('🔧 Painel Admin', 'a_menu')]);
    }
    rows.push([downloadsNav.btnMenu()]);
    return rows;
}

function hubKeyboard(ctx) {
    const rows = [
        [
            Markup.button.callback('🎧 Música', 'downloads:play'),
            Markup.button.callback('📺 YouTube', 'downloads:youtube'),
        ],
        [
            Markup.button.callback('🎬 TikTok', 'downloads:tiktok'),
            Markup.button.callback('📸 Instagram', 'downloads:instagram'),
        ],
        [
            Markup.button.callback('📖 Stories', 'downloads:ig_stories'),
            Markup.button.callback('⭐ Destaques', 'downloads:ig_highlights'),
        ],
    ];
    const channelUrl = downloadsGuard.getDownloadsGroupUrl?.();
    if (channelUrl && String(channelUrl).trim() && groupGuard.isGroupChat(ctx)) {
        rows.push([Markup.button.url(CHANNEL_UI.menuLegacy, String(channelUrl).trim())]);
        const username = String(process.env.BOT_USERNAME || 'hanork_bot').replace(/^@/, '');
        rows.push([Markup.button.url('Downloads no privado', `https://t.me/${username}?start=downloads`)]);
    }
    rows.push(...navRows(ctx));
    return Markup.inlineKeyboard(rows);
}

function sectionKeyboard() {
    return downloadsNav.sectionKeyboard();
}

function instagramKeyboard() {
    return downloadsNav.instagramSectionKeyboard();
}

module.exports = {
    viewer,
    formatHubPanel,
    formatPlayPanel,
    formatTikTokPanel,
    formatYoutubePanel,
    formatInstagramPanel,
    formatInstagramStoriesPanel,
    formatInstagramHighlightsPanel,
    hubKeyboard,
    sectionKeyboard,
    instagramKeyboard,
};
