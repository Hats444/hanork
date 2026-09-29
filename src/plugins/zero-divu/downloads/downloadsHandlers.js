'use strict';

const { Markup } = require('telegraf');
const Msg = require('../Msg');
const downloadsGuard = require('../downloadsGuard');
const downloadsNav = require('./downloadsNav');
const downloadsUi = require('./downloadsUi');
const { safeAnswerCbQuery } = require('../../utils/safeTelegram');
const logger = require('../../config/logger');

async function uiRespond(ctx, text, keyboard = null) {
    const opts = downloadsNav.MENU_PANEL_OPTS;
    if (ctx.callbackQuery?.message) {
        return Msg.editCallbackPanel(ctx, text, keyboard, opts);
    }
    return Msg.replaceMenu(ctx, text, keyboard, opts);
}

async function guardDownloads(ctx) {
    return downloadsGuard.enforceHubAccess(ctx);
}

async function showHub(ctx) {
    await safeAnswerCbQuery(ctx);
    if (!(await guardDownloads(ctx))) return;
    await uiRespond(ctx, downloadsUi.formatHubPanel(ctx), downloadsUi.hubKeyboard(ctx));
    logger.info('[Downloads] hub', { uid: ctx.from?.id });
}

async function showPlay(ctx) {
    await safeAnswerCbQuery(ctx);
    if (!(await guardDownloads(ctx))) return;
    await uiRespond(ctx, downloadsUi.formatPlayPanel(ctx), downloadsUi.sectionKeyboard());
}

async function showTikTok(ctx) {
    await safeAnswerCbQuery(ctx);
    if (!(await guardDownloads(ctx))) return;
    await uiRespond(ctx, downloadsUi.formatTikTokPanel(ctx), downloadsUi.sectionKeyboard());
}

async function showYoutube(ctx) {
    await safeAnswerCbQuery(ctx);
    if (!(await guardDownloads(ctx))) return;
    await uiRespond(ctx, downloadsUi.formatYoutubePanel(ctx), downloadsUi.sectionKeyboard());
}

async function showInstagram(ctx) {
    await safeAnswerCbQuery(ctx);
    if (!(await guardDownloads(ctx))) return;
    await uiRespond(
        ctx,
        downloadsUi.formatInstagramPanel(ctx),
        downloadsUi.instagramKeyboard()
    );
}

async function showIgStories(ctx) {
    await safeAnswerCbQuery(ctx);
    if (!(await guardDownloads(ctx))) return;
    await uiRespond(ctx, downloadsUi.formatInstagramStoriesPanel(ctx), downloadsUi.sectionKeyboard());
}

async function showIgHighlights(ctx) {
    await safeAnswerCbQuery(ctx);
    if (!(await guardDownloads(ctx))) return;
    await uiRespond(ctx, downloadsUi.formatInstagramHighlightsPanel(ctx), downloadsUi.sectionKeyboard());
}

const DownloadsHandlers = {
    'downloads:open': showHub,
    'downloads:hub': showHub,
    'downloads:play': showPlay,
    'downloads:youtube': showYoutube,
    'downloads:tiktok': showTikTok,
    'downloads:instagram': showInstagram,
    'downloads:ig_stories': showIgStories,
    'downloads:ig_highlights': showIgHighlights,
};

function registerDownloadsCommands(bot, { Msg: MsgDep } = {}) {
    const msg = MsgDep || Msg;

    async function openFromCommand(ctx) {
        ctx.state = ctx.state || {};
        ctx.state.commandHandled = true;
        if (!(await downloadsGuard.enforceHubAccess(ctx))) return;
        return msg.reply(
            ctx,
            downloadsUi.formatHubPanel(ctx),
            downloadsUi.hubKeyboard(ctx),
            downloadsNav.MENU_PANEL_OPTS
        );
    }

    bot.command('downloads', openFromCommand);
    bot.command('download', openFromCommand);
}

module.exports = {
    DownloadsHandlers,
    registerDownloadsCommands,
    showHub,
};
