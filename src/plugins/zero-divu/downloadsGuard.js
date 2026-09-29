'use strict';

const { Markup } = require('telegraf');
const groupGuard = require('./groupGuard');
const referenceChannelGuard = require('./referenceChannelGuard');
const downloadsDailyLimit = require('./downloadsDailyLimit');
const { getSalesRefChannelUrl, CHANNEL_UI } = require('../config/salesReferenceChannel');

const DOWNLOAD_COMMANDS = new Set([
    '/play',
    '/tiktok',
    '/instagram',
    '/ig',
    '/youtube',
    '/downloads',
    '/download',
]);

let _groupSettings = null;
let _isAdmin = null;

function configure({ groupSettings, isAdmin, bot } = {}) {
    _groupSettings = groupSettings || null;
    _isAdmin = typeof isAdmin === 'function' ? isAdmin : null;
    if (bot) referenceChannelGuard.configure({ bot, isAdmin });
}

function getChatId(ctx) {
    return ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id ?? null;
}

/** @deprecated Grupo de downloads não é mais exigido — mantido para compat/log. */
function resolveDownloadsGroupId() {
    const envDl = process.env.DOWNLOADS_GROUP_ID;
    if (envDl) {
        const id = parseInt(envDl, 10);
        if (!Number.isNaN(id)) return id;
    }
    if (_groupSettings?.getSupportGroupId) {
        const sup = _groupSettings.getSupportGroupId();
        if (sup) return sup;
    }
    const envSup = process.env.SUPPORT_GROUP_ID || process.env.GRUPO_SUPORTE_ID;
    if (envSup) {
        const id = parseInt(envSup, 10);
        if (!Number.isNaN(id)) return id;
    }
    if (_groupSettings?.getVipGroupId) {
        const vip = _groupSettings.getVipGroupId();
        if (vip) return vip;
    }
    const envVip = process.env.GRUPO_ID;
    if (!envVip) return null;
    const id = parseInt(envVip, 10);
    return Number.isNaN(id) ? null : id;
}

function getDownloadsGroupUrl() {
    return getSalesRefChannelUrl();
}

function isDownloadCommand(cmdText) {
    const cmd = (cmdText || '').split(/\s+/)[0].toLowerCase().replace(/@\w+$/, '');
    return DOWNLOAD_COMMANDS.has(cmd);
}

function isDownloadsAllowedChat(ctx) {
    return groupGuard.isPrivateChat(ctx);
}

/** @deprecated use isDownloadsAllowedChat */
function isDownloadsVipChat(ctx) {
    return isDownloadsAllowedChat(ctx);
}

function canUseDownloads(ctx) {
    const uid = ctx.from?.id;
    if (_isAdmin?.(uid)) return true;
    return groupGuard.isPrivateChat(ctx);
}

function isDownloadsRelatedCallback(data) {
    return /^(play|tiktok|downloads|youtube|instagram):/.test(String(data || ''));
}

async function replyDenied(ctx) {
    const inGroup = groupGuard.isGroupChat(ctx);
    const channelUrl = getSalesRefChannelUrl();
    let title;
    let body;
    if (inGroup) {
        title = '⬇️ Downloads no privado';
        body =
            'Música, YouTube, TikTok e Instagram funcionam no <b>chat privado</b> com o bot.\n\n' +
            'Abra o bot no PV, entre no <b>canal de referências</b> e use <code>/downloads</code> ou cole o link.';
    } else {
        title = '⬇️ Downloads';
        body =
            'Entre no <b>canal de referências</b> para liberar downloads no privado.\n\n' +
            `Limite: <b>${downloadsDailyLimit.getDailyLimit()}</b> downloads por dia.`;
    }
    const text = `<b>${title}</b>\n\n${body}`;
    const rows = [];
    if (channelUrl) {
        rows.push([{ text: CHANNEL_UI.button, url: channelUrl }]);
    }
    if (inGroup) {
        const username = String(process.env.BOT_USERNAME || 'hanork_bot').replace(/^@/, '');
        rows.push([{ text: '💬 Abrir no privado', url: `https://t.me/${username}?start=downloads` }]);
    } else if (referenceChannelGuard.isRefChannelManualVerifyEnabled()) {
        rows.push([{ text: CHANNEL_UI.verify, callback_data: 'ref:verify' }]);
    }
    const kb = rows.length ? Markup.inlineKeyboard(rows) : null;
    try {
        if (ctx.callbackQuery) {
            await ctx.answerCbQuery(inGroup ? '⬇️ Use no privado' : '📢 Entre no canal', {
                show_alert: true,
            }).catch(() => {});
        }
        if (ctx.callbackQuery?.message) {
            const opts = { parse_mode: 'HTML' };
            if (kb) Object.assign(opts, kb);
            try {
                await ctx.editMessageText(text, opts);
            } catch {
                await ctx.reply(text, opts);
            }
        } else {
            const opts = { parse_mode: 'HTML' };
            if (kb) Object.assign(opts, kb);
            await ctx.reply(text, opts);
        }
    } catch (e) {
        const logger = require('../config/logger');
        logger.warn('[downloadsGuard] replyDenied:', e.message);
    }
}

async function replyDailyLimit(ctx) {
    const st = downloadsDailyLimit.getStatus(ctx.from?.id);
    const downloadsNav = require('./downloads/downloadsNav');
    const text =
        `<b>⏳ Limite diário de downloads</b>\n\n` +
        `Você já usou <b>${st.used}/${st.limit}</b> downloads hoje.\n` +
        `O contador zera à meia-noite (horário de Brasília).`;
    const kb = downloadsNav.doneKeyboard(downloadsNav.SECTION.HUB);
    try {
        if (ctx.callbackQuery) {
            await ctx.answerCbQuery('Limite diário atingido', { show_alert: true }).catch(() => {});
        }
        await ctx.reply(text, { parse_mode: 'HTML', ...kb });
    } catch (e) {
        const logger = require('../config/logger');
        logger.warn('[downloadsGuard] replyDailyLimit:', e.message);
    }
}

function canOpenDownloadsHub(ctx) {
    if (_isAdmin?.(ctx.from?.id)) return true;
    return groupGuard.isPrivateChat(ctx);
}

async function enforceHubAccess(ctx) {
    if (!canOpenDownloadsHub(ctx)) {
        await replyDenied(ctx);
        return false;
    }
    if (!(await referenceChannelGuard.enforce(ctx))) return false;
    return true;
}

async function enforceDownloadsAccess(ctx) {
    if (!canUseDownloads(ctx)) {
        await replyDenied(ctx);
        return false;
    }
    if (!(await referenceChannelGuard.enforce(ctx))) return false;

    const consume = downloadsDailyLimit.tryConsume(ctx.from?.id);
    if (!consume.ok) {
        if (consume.reason === 'limit') {
            await replyDailyLimit(ctx);
        } else {
            await replyDenied(ctx);
        }
        return false;
    }
    const logger = require('../config/logger');
    logger.info('[Downloads] slot consumido', {
        uid: ctx.from?.id,
        used: consume.used,
        remaining: consume.remaining,
        limit: consume.limit,
    });
    return true;
}

module.exports = {
    configure,
    DOWNLOAD_COMMANDS,
    isDownloadCommand,
    resolveDownloadsGroupId,
    getDownloadsGroupUrl,
    isDownloadsAllowedChat,
    isDownloadsVipChat,
    canUseDownloads,
    canOpenDownloadsHub,
    isDownloadsRelatedCallback,
    enforceHubAccess,
    enforceDownloadsAccess,
    replyDenied,
    replyDailyLimit,
    getDailyLimit: downloadsDailyLimit.getDailyLimit,
    getDailyStatus: (uid) => downloadsDailyLimit.getStatus(uid),
};
